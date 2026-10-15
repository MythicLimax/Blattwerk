// Web Worker mit PDFium. Lädt das WASM-Modul erst bei der ersten Anfrage.
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfiumEngine } from './engine';
import type { FieldOperationError } from './fields';
import { FormValueError } from './forms';
import { PageOperationError } from './pages';
import type { PageOperation } from '../../shared/pages';
import type { ImageFormat, ProcessRequest, WorkerErrorCode, WorkerRequest, WorkerResponse } from './protocol';
import type { RenderedPage } from './render';
import type { ImageCodec } from './compress';

let enginePromise: Promise<PdfiumEngine> | null = null;

function engine(): Promise<PdfiumEngine> {
  enginePromise ??= (async () => {
    const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
    const module = await init({ wasmBinary });
    module.PDFiumExt_Init();
    return new PdfiumEngine(module);
  })();
  return enginePromise;
}

function reply(response: WorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage: (message: unknown, transfer: Transferable[]) => void }).postMessage(response, transfer);
}

class VerifyError extends Error {}

// Größte Seite beim Zeichnen (Bildpunkte); darüber wird verkleinert. Etwa A3 mit 600 dpi.
const MAX_RENDER_PIXELS = 70_000_000;

// JPEG lesen und schreiben über den Browser (Komprimieren)
const browserCodec: ImageCodec = {
  decodeJpeg: async (bytes) => {
    const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Kein Zeichenbereich');
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    } finally {
      bitmap.close();
    }
  },
  encodeJpeg: async (image, quality) => new Uint8Array(await encodeImage({ ...image, dpi: 0 }, 'jpeg', quality)),
};

// PNG oder JPEG über die Bildkodierung des Browsers (OffscreenCanvas)
async function encodeImage(page: RenderedPage, format: ImageFormat, quality: number): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(page.width, page.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Kein Zeichenbereich');
  context.putImageData(new ImageData(new Uint8ClampedArray(page.rgba.buffer as ArrayBuffer, page.rgba.byteOffset, page.rgba.byteLength), page.width, page.height), 0, 0);
  const blob = await canvas.convertToBlob(format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality });
  return blob.arrayBuffer();
}

// copyOut liefert ein eigenes Array; sein Puffer kann ohne Kopie zurückgegeben werden.
function ownBuffer(output: Uint8Array): ArrayBuffer {
  return output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
    ? (output.buffer as ArrayBuffer)
    : (output.slice().buffer as ArrayBuffer);
}

function replyBytes(id: number, output: Uint8Array, pdfium: PdfiumEngine, password: string | null): void {
  // Kontrolle vor dem Schreiben: Die neuen Bytes müssen sich wieder öffnen lassen.
  if (!pdfium.canOpen(output, password)) throw new VerifyError('Ergebnis lässt sich nicht öffnen');
  const buffer = ownBuffer(output);
  reply({ id, ok: true, kind: 'bytes', bytes: buffer }, [buffer]);
}

// pdf-lib (Feldoperationen, Reparatur übernommener Seiten) wird erst bei Bedarf geladen.
const loadFields = () => import('./fields');
const loadImported = () => import('./imported');
const loadRedaction = () => import('./redaction');
const loadStamping = () => import('./stamping');
const loadProtection = () => import('./protection');
const loadCompress = () => import('./compress');
const loadCompare = () => import('./compare');
const loadSigning = () => import('./signing');
const loadSignatures = () => import('./signatures');
const loadIdentity = () => import('./identity');
const loadPdfA = () => import('./pdfa');

const NO_CHANGES = { upserts: [], deletions: [] };

// Kommentare, Formularwerte und Seitenoperationen mit PDFium. Jede Einfügung aus einer anderen Datei wird
// einzeln ausgeführt und danach repariert (imported.ts); so ist die Lage der neuen Seiten bekannt.
async function processPages(pdfium: PdfiumEngine, request: ProcessRequest): Promise<Uint8Array> {
  const input = new Uint8Array(request.bytes);
  const options = { incremental: request.incremental };
  const pdfiumWork =
    request.changes.upserts.length > 0 ||
    request.changes.deletions.length > 0 ||
    request.operations.length > 0 ||
    request.formValues.length > 0 ||
    request.contentOperations.length > 0 ||
    !request.incremental;
  if (!pdfiumWork) return input;
  if (!request.operations.some((op) => op.type === 'insertPdf')) {
    return pdfium.process(input, request.password, request.changes, request.operations, options, request.formValues, request.contentOperations);
  }
  let output: Uint8Array = input;
  let first = true;
  let pending: PageOperation[] = [];
  const flush = () => {
    output = pdfium.process(output, request.password, first ? request.changes : NO_CHANGES, pending, options, first ? request.formValues : []);
    first = false;
    pending = [];
  };
  for (const op of request.operations) {
    pending.push(op);
    if (op.type !== 'insertPdf') continue;
    flush();
    output = await (await loadImported()).repairInserted(output, op.source, op.at);
  }
  if (pending.length > 0) flush();
  return output;
}

function isFieldError(error: unknown): error is FieldOperationError {
  return error instanceof Error && error.name === 'FieldOperationError';
}

function errorCode(error: unknown): WorkerErrorCode {
  if (isFieldError(error)) return error.code;
  if (error instanceof Error && error.name === 'SanitizeError') return 'redact-encrypted';
  if (error instanceof Error && error.name === 'CompressError') return 'compress-encrypted';
  if (error instanceof Error && error.name === 'PdfAError') return (error as Error & { code: WorkerErrorCode }).code;
  if (error instanceof Error && error.name === 'SignError') return (error as Error & { code: WorkerErrorCode }).code;
  if (error instanceof Error && (error.name === 'StampError' || error.name === 'ContentError')) return (error as Error & { code: WorkerErrorCode }).code;
  if (error instanceof PageOperationError) return error.code;
  if (error instanceof FormValueError) return 'form';
  if (error instanceof VerifyError) return 'verify';
  return 'failed';
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const pdfium = await engine();
      switch (request.type) {
        case 'process': {
          let output = await processPages(pdfium, request);
          if (request.fieldOperations.length > 0) {
            const { applyFieldOperations } = await loadFields();
            output = await applyFieldOperations(output, request.fieldOperations);
          }
          if (request.stampOperations.length > 0) {
            const { applyStampOperations } = await loadStamping();
            output = await applyStampOperations(output, request.stampOperations);
          }
          replyBytes(request.id, output, pdfium, request.password);
          return;
        }
        case 'compose': {
          let output = pdfium.compose(request.parts);
          if (request.parts.some((part) => part.type === 'pdf')) output = await (await loadImported()).repairComposed(output, request.parts);
          replyBytes(request.id, output, pdfium, null);
          return;
        }
        case 'redact': {
          const { redactDocument } = await loadRedaction();
          const output = await redactDocument(
            pdfium,
            new Uint8Array(request.bytes),
            request.password,
            request.changes,
            request.formValues,
            request.areas,
            request.options,
          );
          replyBytes(request.id, output, pdfium, request.password);
          return;
        }
        case 'findText': {
          const result = pdfium.findText(new Uint8Array(request.bytes), request.password, request.options);
          reply({ id: request.id, ok: true, kind: 'matches', ...result });
          return;
        }
        case 'listObjects':
          reply({ id: request.id, ok: true, kind: 'objects', pages: pdfium.listObjects(new Uint8Array(request.bytes), request.password, request.pages) });
          return;
        case 'security':
          reply({ id: request.id, ok: true, kind: 'security', security: pdfium.security(new Uint8Array(request.bytes), request.password) });
          return;
        case 'protect': {
          const { settings } = request;
          let output = pdfium.process(new Uint8Array(request.bytes), request.password, request.changes, [], { incremental: false, removeSecurity: true }, request.formValues);
          const protectedOutput = settings && (settings.openPassword !== null || settings.permissionsPassword !== null);
          if (protectedOutput) output = await (await loadProtection()).encryptDocument(output, settings);
          replyBytes(request.id, output, pdfium, protectedOutput ? (settings.openPassword ?? settings.permissionsPassword) : null);
          return;
        }
        case 'openSession': {
          const opened = pdfium.openSession(new Uint8Array(request.bytes), request.password, request.changes, request.formValues);
          reply({ id: request.id, ok: true, kind: 'session', session: opened.id, pageCount: opened.pageCount });
          return;
        }
        case 'renderPage': {
          const page = pdfium.sessions.render(request.session, request.pageIndex, request.dpi, MAX_RENDER_PIXELS);
          const bytes = request.format === 'rgba' ? (page.rgba.buffer as ArrayBuffer) : await encodeImage(page, request.format, request.quality);
          reply({ id: request.id, ok: true, kind: 'image', bytes, width: page.width, height: page.height, dpi: page.dpi }, [bytes]);
          return;
        }
        case 'pageText':
          reply({ id: request.id, ok: true, kind: 'text', text: pdfium.sessions.text(request.session, request.pageIndex) });
          return;
        case 'closeSession':
          pdfium.sessions.close(request.session);
          reply({ id: request.id, ok: true, kind: 'done' });
          return;
        case 'compress': {
          const full = pdfium.process(new Uint8Array(request.bytes), request.password, request.changes, [], { incremental: false }, request.formValues);
          const { compressDocument } = await loadCompress();
          const result = await compressDocument(full, request.level, browserCodec);
          replyBytes(request.id, result.bytes, pdfium, request.password);
          return;
        }
        case 'compare': {
          // Ohne Schutz (nur für den Bericht), dann Wörter je Seite
          const plain = (bytes: ArrayBuffer, password: string | null) =>
            pdfium.process(new Uint8Array(bytes), password, NO_CHANGES, [], { incremental: false, removeSecurity: true });
          const words = (bytes: Uint8Array) => {
            const { id, pageCount } = pdfium.sessions.open(bytes, null);
            try {
              return Array.from({ length: pageCount }, (_, i) => pdfium.sessions.words(id, i));
            } finally {
              pdfium.sessions.close(id);
            }
          };
          const oldBytes = plain(request.oldBytes, request.oldPassword);
          const newBytes = plain(request.newBytes, request.newPassword);
          const { buildCompareReport } = await loadCompare();
          const report = await buildCompareReport({ oldBytes, newBytes, oldWords: words(oldBytes), newWords: words(newBytes), names: request.names, labels: request.labels });
          replyBytes(request.id, report.bytes, pdfium, null);
          return;
        }
        case 'sign': {
          const pending = request.changes.upserts.length > 0 || request.changes.deletions.length > 0 || request.formValues.length > 0;
          const input = new Uint8Array(request.bytes);
          const current = pending ? pdfium.process(input, request.password, request.changes, [], { incremental: true }, request.formValues) : input;
          const { signDocument } = await loadSigning();
          replyBytes(request.id, await signDocument(current, request.input), pdfium, request.password);
          return;
        }
        case 'verifySignatures': {
          const { verifySignatures } = await loadSignatures();
          reply({ id: request.id, ok: true, kind: 'signatures', checks: await verifySignatures(new Uint8Array(request.bytes)) });
          return;
        }
        case 'createIdentity': {
          const { createIdentity } = await loadIdentity();
          const bytes = ownBuffer(await createIdentity(request));
          reply({ id: request.id, ok: true, kind: 'raw', bytes }, [bytes]);
          return;
        }
        case 'pdfa': {
          const full = pdfium.process(new Uint8Array(request.bytes), request.password, request.changes, [], { incremental: false, removeSecurity: true }, request.formValues);
          const { convertToPdfA } = await loadPdfA();
          const result = await convertToPdfA(
            full,
            { standardFont: (name) => pdfium.standardFontProgram(name), cmykProfile: request.cmykProfile ? new Uint8Array(request.cmykProfile) : null },
            new Date(),
            request.producer,
          );
          replyBytes(request.id, result.bytes, pdfium, null);
          return;
        }
        case 'checkPdfA': {
          const { checkPdfA } = await loadPdfA();
          reply({ id: request.id, ok: true, kind: 'pdfa', report: await checkPdfA(new Uint8Array(request.bytes)) });
          return;
        }
        case 'inspect':
          reply({ id: request.id, ok: true, kind: 'inspect', result: pdfium.inspect(new Uint8Array(request.bytes), request.password) });
          return;
      }
    } catch (error) {
      reply({ id: request.id, ok: false, code: errorCode(error), error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
