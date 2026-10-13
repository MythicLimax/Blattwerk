import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { FileInfo } from '../../shared/ipc';
import { api } from '../api';
import { readChunked } from './file-reader';
import { createPdfWorker, pdfjs, PDFJS_ASSETS } from './pdfjs';
import { createRangeTransport, RANGE_CHUNK_SIZE, WHOLE_FILE_LIMIT } from './range-transport';

export interface LoadedDocumentHandle {
  task: PDFDocumentLoadingTask;
  // Wie task.promise, wird aber auch beim Abbrechen (terminate) abgelehnt.
  // pdf.js selbst lässt task.promise offen, wenn der Worker während des Ladens beendet wird.
  promise: Promise<PDFDocumentProxy>;
  terminate: () => void;
}

export class LoadAbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'LoadAbortedError';
  }
}

export interface LoadCallbacks {
  // Bekanntes Kennwort (z. B. beim Neuladen nach dem Speichern); dann entfällt die Abfrage.
  password?: string | null;
  onPassword: (reason: 'need' | 'incorrect', submit: (password: string) => void) => void;
  onRangeError: (error: unknown) => void;
  // Dokument aus dem Arbeitsspeicher statt aus der Datei (Stand nach Seitenänderungen). Wird kopiert,
  // weil pdf.js den Puffer an seinen Worker abgibt und der Aufrufer ihn behalten will.
  data?: Uint8Array;
}

// Sicherheitsrelevant: kein JavaScript aus PDFs, kein XFA, keine Netzwerkzugriffe aus dem Dokument.
function safeOptions(worker: pdfjs.PDFWorker, password: string | null | undefined) {
  return {
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
    password: password ?? undefined,
  } as const;
}

// Öffnet Bytes aus dem Speicher als eigenes, kurzlebiges Dokument (z. B. Druck mit ungespeicherten Kommentaren).
export async function openTemporary(
  data: Uint8Array,
  password: string | null,
): Promise<{ pdf: PDFDocumentProxy; destroy: () => Promise<void> }> {
  const { worker, terminate } = createPdfWorker('temp');
  const task = pdfjs.getDocument({ ...safeOptions(worker, password), data });
  const destroy = async () => {
    await task.destroy().catch(() => undefined);
    terminate();
  };
  try {
    return { pdf: await task.promise, destroy };
  } catch (error) {
    await destroy();
    throw error;
  }
}

export async function startLoading(file: FileInfo, callbacks: LoadCallbacks): Promise<LoadedDocumentHandle> {
  const { worker, terminate } = createPdfWorker(file.fileId.slice(0, 8));
  const read = (begin: number, end: number) => api.readRange(file.fileId, begin, end);
  const common = safeOptions(worker, callbacks.password);

  let task: PDFDocumentLoadingTask;
  try {
    if (callbacks.data) {
      task = pdfjs.getDocument({ ...common, data: callbacks.data.slice() });
    } else if (file.size <= WHOLE_FILE_LIMIT) {
      const data = await readChunked(read, 0, file.size);
      task = pdfjs.getDocument({ ...common, data });
    } else {
      const initialEnd = Math.min(RANGE_CHUNK_SIZE, file.size);
      const initialData = await read(0, initialEnd);
      const range = createRangeTransport(pdfjs.PDFDataRangeTransport, file.size, initialData, read, callbacks.onRangeError);
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

  const aborted = Promise.withResolvers<never>();
  aborted.promise.catch(() => undefined);
  let terminated = false;

  return {
    task,
    promise: Promise.race([task.promise, aborted.promise]),
    terminate: () => {
      if (terminated) return;
      terminated = true;
      aborted.reject(new LoadAbortedError());
      // Erst pdf.js sauber abbauen lassen, dann den Worker beenden. Sonst warten offene
      // pdf.js-Aufrufe (z. B. getPage beim Drucken) für immer auf einen toten Worker.
      void task
        .destroy()
        .catch(() => undefined)
        .finally(terminate);
    },
  };
}
