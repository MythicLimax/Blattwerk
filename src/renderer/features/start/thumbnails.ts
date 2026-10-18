// Vorschaubilder der Startseite (ADR 0028): erste Seite als kleines PNG. Für zuletzt geöffnete Dateien entsteht es beim
// Öffnen (aus dem schon geladenen Dokument), für Vorlagen beim ersten Anzeigen der Startseite; der Hauptprozess speichert es.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { api } from '../../api';
import { pdfjs } from '../../engine/pdfjs';
import { openTemporary } from '../../engine/document-loader';

export const THUMBNAIL_WIDTH = 240;

export async function renderFirstPage(pdf: PDFDocumentProxy, width = THUMBNAIL_WIDTH): Promise<Uint8Array> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  // pdf.js legt die Seite auf weißen Grund
  await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('kein Bild');
  return new Uint8Array(await blob.arrayBuffer());
}

// Nach dem Laden einer Datei: Vorschaubild für „Zuletzt geöffnet“ ablegen (Fehler sind hier ohne Folgen)
export async function storeFileThumbnail(fileId: string, pdf: PDFDocumentProxy): Promise<void> {
  try {
    await api.thumbnails.setFile(fileId, await renderFirstPage(pdf));
  } catch {
    // Kein Vorschaubild: Die Startseite zeigt dann ein Symbol
  }
}

// Vorschaubild einer Vorlage erzeugen und ablegen; liefert die data:-Adresse
export async function createTemplateThumbnail(id: string): Promise<string | null> {
  const bytes = await api.templates.preview(id).catch(() => null);
  if (!bytes) return null;
  const { pdf, destroy } = await openTemporary(bytes, null);
  try {
    const png = await renderFirstPage(pdf);
    await api.thumbnails.setTemplate(id, png);
    const blob = new Blob([png.slice().buffer], { type: 'image/png' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Bild nicht lesbar'));
      reader.readAsDataURL(blob);
    });
  } finally {
    await destroy();
  }
}
