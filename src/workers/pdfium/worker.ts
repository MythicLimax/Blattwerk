// Web Worker mit PDFium. Lädt das WASM-Modul erst bei der ersten Anfrage (Phase 2: Speichern von Kommentaren).
import { init } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfiumEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

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

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const pdfium = await engine();
      const output = pdfium.applyAndSave(new Uint8Array(request.bytes), request.password, request.changes, {
        incremental: request.incremental,
      });
      // Kontrolle vor dem Schreiben: Die neuen Bytes müssen sich wieder öffnen lassen.
      if (!pdfium.canOpen(output, request.password)) throw new Error('verify-failed');
      // copyOut liefert ein eigenes Array; sein Puffer kann ohne Kopie zurückgegeben werden.
      const buffer =
        output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
          ? (output.buffer as ArrayBuffer)
          : (output.slice().buffer as ArrayBuffer);
      reply({ id: request.id, ok: true, bytes: buffer }, [buffer]);
    } catch (error) {
      reply({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});
