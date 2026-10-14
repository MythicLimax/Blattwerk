// Web Worker mit PDFium. Lädt das WASM-Modul erst bei der ersten Anfrage.
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfiumEngine } from './engine';
import type { FieldOperationError } from './fields';
import { FormValueError } from './forms';
import { PageOperationError } from './pages';
import type { PageOperation } from '../../shared/pages';
import type { ProcessRequest, WorkerErrorCode, WorkerRequest, WorkerResponse } from './protocol';

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
        case 'inspect':
          reply({ id: request.id, ok: true, kind: 'inspect', result: pdfium.inspect(new Uint8Array(request.bytes), request.password) });
          return;
      }
    } catch (error) {
      reply({ id: request.id, ok: false, code: errorCode(error), error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
