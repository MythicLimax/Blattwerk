import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { pdfjs } from '../../engine/pdfjs';

// Breite einer Miniatur in CSS-Pixeln und die Renderbreite (für scharfe Darstellung auf Retina).
export const THUMB_WIDTH = 120;
export const THUMB_RENDER_WIDTH = 240;
const MAX_ENTRIES = 400;

export interface ThumbEntry {
  url: string;
  width: number;
  height: number;
}

type Listener = (key: string) => void;

function keyOf(pageNumber: number, rotation: number): string {
  return `${pageNumber}:${rotation}`;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 400 });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

function canvasToEntry(canvas: HTMLCanvasElement): Promise<ThumbEntry | null> {
  const { width, height } = canvas;
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? { url: URL.createObjectURL(blob), width, height } : null);
    }, 'image/png');
  });
}

// Miniaturen eines Dokuments: Cache (LRU) und eine Warteschlange, die immer nur eine Seite rendert.
// Zuletzt angeforderte Seiten kommen zuerst dran (das sind die gerade sichtbaren).
export class ThumbnailCache {
  #entries = new Map<string, ThumbEntry>();
  #listeners = new Set<Listener>();
  #queue: Array<{ pdf: PDFDocumentProxy; pageNumber: number; rotation: number }> = [];
  #running: { key: string; task: RenderTask | null } | null = null;
  #cleared = false;

  get(pageNumber: number, rotation: number): ThumbEntry | undefined {
    const key = keyOf(pageNumber, rotation);
    const entry = this.#entries.get(key);
    if (entry) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  request(pdf: PDFDocumentProxy, pageNumber: number, rotation: number): void {
    const key = keyOf(pageNumber, rotation);
    if (this.#entries.has(key) || this.#running?.key === key) return;
    this.#queue = this.#queue.filter((item) => keyOf(item.pageNumber, item.rotation) !== key);
    this.#queue.push({ pdf, pageNumber, rotation });
    void this.#pump();
  }

  cancel(pageNumber: number, rotation: number): void {
    const key = keyOf(pageNumber, rotation);
    this.#queue = this.#queue.filter((item) => keyOf(item.pageNumber, item.rotation) !== key);
    if (this.#running?.key === key) this.#running.task?.cancel();
  }

  // Wird mit dem Canvas einer Seite aufgerufen, die der Viewer gerade fertig gerendert hat.
  offerRenderedPage(pageNumber: number, source: HTMLCanvasElement, rotation = 0): void {
    const key = keyOf(pageNumber, rotation);
    if (this.#entries.has(key) || source.width === 0 || source.height === 0) return;
    const scale = THUMB_RENDER_WIDTH / source.width;
    if (scale > 1.5) return; // zu klein für eine scharfe Miniatur
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    void canvasToEntry(canvas).then((entry) => {
      if (entry) this.#store(key, entry);
    });
  }

  clear(): void {
    this.#cleared = true;
    this.#queue = [];
    this.#running?.task?.cancel();
    for (const entry of this.#entries.values()) URL.revokeObjectURL(entry.url);
    this.#entries.clear();
    this.#listeners.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  #store(key: string, entry: ThumbEntry): void {
    if (this.#cleared) {
      URL.revokeObjectURL(entry.url);
      return;
    }
    const old = this.#entries.get(key);
    if (old) URL.revokeObjectURL(old.url);
    this.#entries.set(key, entry);
    while (this.#entries.size > MAX_ENTRIES) {
      const oldestKey = this.#entries.keys().next().value as string;
      const oldest = this.#entries.get(oldestKey);
      if (oldest) URL.revokeObjectURL(oldest.url);
      this.#entries.delete(oldestKey);
    }
    for (const listener of this.#listeners) listener(key);
  }

  async #pump(): Promise<void> {
    if (this.#running || this.#cleared) return;
    const next = this.#queue.pop();
    if (!next) return;
    const key = keyOf(next.pageNumber, next.rotation);
    this.#running = { key, task: null };
    try {
      // Erst rendern, wenn die Hauptansicht Luft hat.
      await idle();
      if (this.#cleared || this.#entries.has(key)) return;
      const page = await next.pdf.getPage(next.pageNumber);
      const base = page.getViewport({ scale: 1, rotation: next.rotation + page.rotate });
      const viewport = page.getViewport({ scale: THUMB_RENDER_WIDTH / base.width, rotation: next.rotation + page.rotate });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE });
      if (this.#running) this.#running.task = task;
      await task.promise;
      const entry = await canvasToEntry(canvas);
      canvas.width = 0;
      canvas.height = 0;
      if (entry) this.#store(key, entry);
    } catch {
      // Abgebrochen oder fehlerhafte Seite: die Miniatur bleibt leer und wird beim nächsten Anzeigen neu angefordert.
    } finally {
      this.#running = null;
      void this.#pump();
    }
  }
}
