// Zentrale Einrichtung von pdf.js für den Renderer.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export { pdfjs };

// Ressourcen von pdf.js liegen unter app://bundle/pdfjs/ (siehe scripts/copy-pdfjs-assets.mjs).
function assetUrl(relative: string): string {
  return new URL(relative, document.baseURI).href;
}

export const PDFJS_ASSETS = {
  get cMapUrl() {
    return assetUrl('pdfjs/cmaps/');
  },
  get standardFontDataUrl() {
    return assetUrl('pdfjs/standard_fonts/');
  },
  get wasmUrl() {
    return assetUrl('pdfjs/wasm/');
  },
  get iccUrl() {
    return assetUrl('pdfjs/iccs/');
  },
  get imageResourcesPath() {
    return assetUrl('pdfjs/images/');
  },
};

// Jedes Dokument bekommt einen eigenen Worker. Schließen des Tabs beendet ihn und gibt den Speicher frei.
export function createPdfWorker(name: string): { worker: pdfjs.PDFWorker; terminate: () => void } {
  const port = new Worker(workerUrl, { type: 'module', name: `pdfjs-${name}` });
  // Die Typdefinition von pdf.js beschreibt name und port zu eng; zur Laufzeit sind String und Worker erlaubt.
  const options = { name, port } as unknown as ConstructorParameters<typeof pdfjs.PDFWorker>[0];
  const worker = new pdfjs.PDFWorker(options);
  return {
    worker,
    terminate: () => {
      worker.destroy();
      port.terminate();
    },
  };
}
