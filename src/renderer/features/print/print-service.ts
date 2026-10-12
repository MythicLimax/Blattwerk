import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PrintResult } from '../../../shared/ipc';
import { pdfjs } from '../../engine/pdfjs';

// Druckauflösung. pdf.js und Firefox drucken mit 150 dpi; höhere Werte kosten viel Speicher bei großen Dokumenten.
export const PRINT_DPI = 150;
const PDF_POINTS_PER_INCH = 72;

export interface PrintCallbacks {
  onProgress: (current: number, total: number) => void;
  print: () => Promise<PrintResult>;
}

// Rendert alle Seiten als Bilder in den Druckbereich (#print-container) und öffnet dann den Systemdruck.
// Die Seitengröße folgt der ersten Seite; andere Formate werden eingepasst.
export async function printDocument(
  pdf: PDFDocumentProxy,
  callbacks: PrintCallbacks,
  signal: AbortSignal,
): Promise<PrintResult> {
  const container = document.getElementById('print-container');
  if (!container) return { ok: false, reason: 'failed', detail: 'print-container fehlt' };
  const urls: string[] = [];
  const style = document.createElement('style');
  try {
    const first = await pdf.getPage(1);
    const firstViewport = first.getViewport({ scale: 1 });
    style.textContent = `@page { size: ${firstViewport.width}pt ${firstViewport.height}pt; margin: 0; }`;
    document.head.appendChild(style);

    const total = pdf.numPages;
    const scale = PRINT_DPI / PDF_POINTS_PER_INCH;
    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      if (signal.aborted) return { ok: false, reason: 'cancelled' };
      callbacks.onProgress(pageNumber, total);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Kein Zeichenkontext');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, intent: 'print', annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('Seite konnte nicht in ein Bild umgewandelt werden');
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const wrapper = document.createElement('div');
      wrapper.className = 'printed-page';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      wrapper.appendChild(img);
      container.appendChild(wrapper);
    }
    // Warten, bis alle Bilder dekodiert sind, sonst druckt Chromium leere Seiten.
    await Promise.all([...container.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    if (signal.aborted) return { ok: false, reason: 'cancelled' };
    return await callbacks.print();
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    container.replaceChildren();
    for (const url of urls) URL.revokeObjectURL(url);
    style.remove();
  }
}
