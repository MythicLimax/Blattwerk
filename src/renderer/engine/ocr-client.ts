// Texterkennung mit tesseract.js (Phase 6, ADR 0015). Worker, WASM-Kern und Sprachdaten kommen aus dem App-Paket
// (public/ocr, beim Build kopiert); es wird nichts aus dem Netz geladen und nichts zwischengespeichert.
import { createWorker, type Worker } from 'tesseract.js';
import type { OcrBlock } from '../../shared/ocr';

export type OcrLanguage = 'deu' | 'eng';

const LSTM_ONLY = 1;

const base = () => new URL('ocr/', document.baseURI).href;

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrBlock[] | null>;
  stop(): Promise<void>;
}

export async function startOcr(languages: OcrLanguage[]): Promise<OcrEngine> {
  const worker: Worker = await createWorker(languages, LSTM_ONLY, {
    workerPath: `${base()}worker.min.js`,
    corePath: `${base()}core`,
    langPath: `${base()}lang`,
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
  });
  return {
    recognize: async (image) => {
      const result = await worker.recognize(new Blob([image as Uint8Array<ArrayBuffer>]), {}, { blocks: true, text: false });
      return result.data.blocks as unknown as OcrBlock[] | null;
    },
    stop: async () => {
      await worker.terminate();
    },
  };
}
