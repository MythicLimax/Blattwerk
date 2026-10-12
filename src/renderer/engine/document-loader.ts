import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { FileInfo } from '../../shared/ipc';
import { api } from '../api';
import { readChunked } from './file-reader';
import { createPdfWorker, pdfjs, PDFJS_ASSETS } from './pdfjs';
import { createRangeTransport } from './range-transport';

// Bis zu dieser Größe wird die Datei in einem Stück gelesen. Größere Dateien lädt pdf.js bei Bedarf in Bereichen.
export const WHOLE_FILE_LIMIT = 8 * 1024 * 1024;
// pdf.js fordert Daten in Blöcken dieser Größe an.
export const RANGE_CHUNK_SIZE = 256 * 1024;

export interface LoadedDocumentHandle {
  task: PDFDocumentLoadingTask;
  terminate: () => void;
}

export interface LoadCallbacks {
  onPassword: (reason: 'need' | 'incorrect', submit: (password: string) => void) => void;
  onRangeError: (error: unknown) => void;
}

export async function startLoading(file: FileInfo, callbacks: LoadCallbacks): Promise<LoadedDocumentHandle> {
  const { worker, terminate } = createPdfWorker(file.fileId.slice(0, 8));
  const read = (begin: number, end: number) => api.readRange(file.fileId, begin, end);

  // Sicherheitsrelevant: kein JavaScript aus PDFs, kein XFA, keine Netzwerkzugriffe aus dem Dokument.
  const common = {
    worker,
    cMapUrl: PDFJS_ASSETS.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_ASSETS.standardFontDataUrl,
    wasmUrl: PDFJS_ASSETS.wasmUrl,
    iccUrl: PDFJS_ASSETS.iccUrl,
    useWorkerFetch: true,
    enableXfa: false,
    isOffscreenCanvasSupported: true,
    stopAtErrors: false,
  } as const;

  let task: PDFDocumentLoadingTask;
  try {
    if (file.size <= WHOLE_FILE_LIMIT) {
      const data = await readChunked(read, 0, file.size);
      task = pdfjs.getDocument({ ...common, data });
    } else {
      const initialEnd = Math.min(RANGE_CHUNK_SIZE, file.size);
      const initialData = await read(0, initialEnd);
      const range = createRangeTransport(file.size, initialData, read, callbacks.onRangeError);
      task = pdfjs.getDocument({
        ...common,
        range,
        rangeChunkSize: RANGE_CHUNK_SIZE,
        disableAutoFetch: true,
        disableStream: true,
      });
    }
  } catch (error) {
    terminate();
    throw error;
  }

  task.onPassword = (submit: (password: string) => void, reason: number) => {
    callbacks.onPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? 'incorrect' : 'need', submit);
  };

  return {
    task,
    terminate: () => {
      void task.destroy().catch(() => undefined);
      terminate();
    },
  };
}
