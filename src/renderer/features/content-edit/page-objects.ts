// Seitenobjekte (Text, Bilder) zum Bearbeiten, je pdf.js-Dokument zwischengespeichert. Anfragen mehrerer Seiten
// werden kurz gesammelt und gemeinsam an den Worker geschickt (er öffnet das Dokument dann nur einmal).
import type { PageObjects } from '../../../shared/content';
import { listPageObjects } from '../../engine/pdfium-client';

interface PdfLike {
  getData(): Promise<Uint8Array>;
}

interface Batch {
  pages: Map<number, Array<(objects: PageObjects | null) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
}

const cache = new WeakMap<object, Map<number, Promise<PageObjects | null>>>();
const batches = new WeakMap<object, Batch>();
const BATCH_MS = 40;

function flush(pdf: PdfLike, password: string | null): void {
  const batch = batches.get(pdf);
  if (!batch) return;
  batches.delete(pdf);
  const pages = [...batch.pages.keys()];
  void (async () => {
    try {
      const result = await listPageObjects(await pdf.getData(), password, pages);
      for (const [pageIndex, waiters] of batch.pages) {
        const objects = result.find((entry) => entry.pageIndex === pageIndex) ?? null;
        for (const resolve of waiters) resolve(objects);
      }
    } catch {
      for (const waiters of batch.pages.values()) for (const resolve of waiters) resolve(null);
    }
  })();
}

export function pageObjects(pdf: PdfLike, password: string | null, pageIndex: number): Promise<PageObjects | null> {
  let pages = cache.get(pdf);
  if (!pages) {
    pages = new Map();
    cache.set(pdf, pages);
  }
  const cached = pages.get(pageIndex);
  if (cached) return cached;
  const promise = new Promise<PageObjects | null>((resolve) => {
    let batch = batches.get(pdf);
    if (!batch) {
      batch = { pages: new Map(), timer: null };
      batches.set(pdf, batch);
    }
    batch.pages.set(pageIndex, [...(batch.pages.get(pageIndex) ?? []), resolve]);
    if (!batch.timer) batch.timer = setTimeout(() => flush(pdf, password), BATCH_MS);
  });
  pages.set(pageIndex, promise);
  return promise;
}
