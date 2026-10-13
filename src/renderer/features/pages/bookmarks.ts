// Seiten der obersten Lesezeichen (zum Teilen an Kapitelgrenzen).
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Ziel eines Lesezeichens: benanntes Ziel oder explizites Ziel [Seitenverweis, Art, …]
type Destination = string | unknown[] | null;

async function pageOf(pdf: PDFDocumentProxy, dest: Destination): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const target = explicit?.[0];
    if (typeof target === 'number') return target;
    if (target && typeof target === 'object') return await pdf.getPageIndex(target as { num: number; gen: number });
  } catch {
    // Kaputtes Ziel: dieses Lesezeichen zählt nicht
  }
  return null;
}

// 0-basierte Seiten der obersten Lesezeichen, sortiert und ohne Doppelte
export async function topLevelBookmarkPages(pdf: PDFDocumentProxy): Promise<number[]> {
  const outline = (await pdf.getOutline().catch(() => null)) ?? [];
  const pages = await Promise.all(outline.map((item) => pageOf(pdf, item.dest as Destination)));
  return [...new Set(pages.filter((p): p is number => p !== null && p >= 0 && p < pdf.numPages))].sort((a, b) => a - b);
}
