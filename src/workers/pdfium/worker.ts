// Web Worker mit PDFium. Lädt das WASM-Modul erst bei der ersten Anfrage.
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfiumEngine } from './engine';
import type { FieldOperationError } from './fields';
import { FormValueError } from './forms';
import { PageOperationError } from './pages';
import type { WorkerErrorCode, WorkerRequest, WorkerResponse } from './protocol';

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

// pdf-lib (nur für Feldoperationen) wird erst bei Bedarf geladen.
const loadFields = () => import('./fields');

function isFieldError(error: unknown): error is FieldOperationError {
  return error instanceof Error && error.name === 'FieldOperationError';
}

function errorCode(error: unknown): WorkerErrorCode {
  if (isFieldError(error)) return error.code;
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
          const input = new Uint8Array(request.bytes);
          const pdfiumWork =
            request.changes.upserts.length > 0 ||
            request.changes.deletions.length > 0 ||
            request.operations.length > 0 ||
            request.formValues.length > 0 ||
            !request.incremental;
          let output = pdfiumWork
            ? pdfium.process(input, request.password, request.changes, request.operations, { incremental: request.incremental }, request.formValues)
            : input;
          if (request.fieldOperations.length > 0) {
            const { applyFieldOperations } = await loadFields();
            output = await applyFieldOperations(output, request.fieldOperations);
          }
          replyBytes(request.id, output, pdfium, request.password);
          return;
        }
        case 'compose':
          replyBytes(request.id, pdfium.compose(request.parts), pdfium, null);
          return;
        case 'inspect':
          reply({ id: request.id, ok: true, kind: 'inspect', result: pdfium.inspect(new Uint8Array(request.bytes), request.password) });
          return;
      }
    } catch (error) {
      reply({ id: request.id, ok: false, code: errorCode(error), error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
