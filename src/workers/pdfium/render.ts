// Seiten zeichnen und Text auslesen (Phase 6: Export, Texterkennung, Vergleich). Ein Dokument bleibt für mehrere
// Seiten geöffnet (Sitzung), damit große Dateien nicht für jede Seite neu geladen werden.
import type { PageWord } from '../../shared/compare';
import { withBuffer, type Pdfium } from './memory';

const RENDER_ANNOTATIONS = 0x01;
const BITMAP_BGRX = 0;

export interface RenderedPage {
  width: number;
  height: number;
  // RGBA, Zeile für Zeile
  rgba: Uint8Array;
  // Tatsächliche Auflösung (kleiner als verlangt, wenn die Seite sonst zu groß würde)
  dpi: number;
}

interface Session {
  doc: number;
  data: number;
  // Formular-Umgebung: Ohne sie zeichnet PDFium in Dokumenten mit Formular keine Felder (auch keine Unterschriften)
  formInfo: number;
  form: number;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export class DocumentSessions {
  readonly #m: Pdfium;
  readonly #sessions = new Map<number, Session>();
  #next = 1;

  constructor(m: Pdfium) {
    this.#m = m;
  }

  open(bytes: Uint8Array, password: string | null): { id: number; pageCount: number } {
    const m = this.#m;
    const data = m.pdfium.wasmExports.malloc(Math.max(1, bytes.length));
    if (!data) throw new RenderError('PDFium: kein Speicher');
    m.pdfium.HEAPU8.set(bytes, data);
    const doc = m.FPDF_LoadMemDocument(data, bytes.length, password ?? '');
    if (!doc) {
      m.pdfium.wasmExports.free(data);
      throw new RenderError(`Dokument lässt sich nicht öffnen (Fehler ${m.FPDF_GetLastError()})`);
    }
    const id = this.#next++;
    const formInfo = m.PDFiumExt_OpenFormFillInfo();
    const form = m.PDFiumExt_InitFormFillEnvironment(doc, formInfo);
    this.#sessions.set(id, { doc, data, formInfo, form });
    return { id, pageCount: m.FPDF_GetPageCount(doc) };
  }

  close(id: number): void {
    const session = this.#sessions.get(id);
    if (!session) return;
    this.#sessions.delete(id);
    if (session.form) this.#m.PDFiumExt_ExitFormFillEnvironment(session.form);
    if (session.formInfo) this.#m.PDFiumExt_CloseFormFillInfo(session.formInfo);
    this.#m.FPDF_CloseDocument(session.doc);
    this.#m.pdfium.wasmExports.free(session.data);
  }

  closeAll(): void {
    for (const id of [...this.#sessions.keys()]) this.close(id);
  }

  #withPage<T>(id: number, pageIndex: number, fn: (page: number, form: number) => T): T {
    const session = this.#sessions.get(id);
    if (!session) throw new RenderError('Sitzung beendet');
    const page = this.#m.FPDF_LoadPage(session.doc, pageIndex);
    if (!page) throw new RenderError(`Seite ${pageIndex + 1} lässt sich nicht laden`);
    if (session.form) this.#m.FORM_OnAfterLoadPage(page, session.form);
    try {
      return fn(page, session.form);
    } finally {
      if (session.form) this.#m.FORM_OnBeforeClosePage(page, session.form);
      this.#m.FPDF_ClosePage(page);
    }
  }

  // Seite in der angezeigten Ausrichtung (mit /Rotate) und mit Kommentaren. Größere Seiten als maxPixels werden
  // verkleinert.
  render(id: number, pageIndex: number, dpi: number, maxPixels: number): RenderedPage {
    const m = this.#m;
    return this.#withPage(id, pageIndex, (page, form) => {
      const widthPt = m.FPDF_GetPageWidthF(page);
      const heightPt = m.FPDF_GetPageHeightF(page);
      let scale = dpi / 72;
      const pixels = widthPt * scale * heightPt * scale;
      if (pixels > maxPixels) scale *= Math.sqrt(maxPixels / pixels);
      const width = Math.max(1, Math.round(widthPt * scale));
      const height = Math.max(1, Math.round(heightPt * scale));
      const bitmap = m.FPDFBitmap_Create(width, height, BITMAP_BGRX);
      if (!bitmap) throw new RenderError('Bild lässt sich nicht anlegen (zu groß?)');
      try {
        m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, RENDER_ANNOTATIONS);
        // Formularfelder und Unterschriften zeichnet die Formular-Umgebung darüber
        if (form) m.FPDF_FFLDraw(form, bitmap, page, 0, 0, width, height, 0, RENDER_ANNOTATIONS);
        const stride = m.FPDFBitmap_GetStride(bitmap);
        const buffer = m.FPDFBitmap_GetBuffer(bitmap);
        const heap = m.pdfium.HEAPU8;
        const rgba = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
          let source = buffer + y * stride;
          let target = y * width * 4;
          for (let x = 0; x < width; x++, source += 4, target += 4) {
            rgba[target] = heap[source + 2] as number;
            rgba[target + 1] = heap[source + 1] as number;
            rgba[target + 2] = heap[source] as number;
            rgba[target + 3] = 255;
          }
        }
        return { width, height, rgba, dpi: scale * 72 };
      } finally {
        m.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  // Text einer Seite in Lesereihenfolge, wie PDFium ihn erkennt (Zeilenenden als \n)
  text(id: number, pageIndex: number): string {
    const m = this.#m;
    return this.#withPage(id, pageIndex, (page) => {
      const textPage = m.FPDFText_LoadPage(page);
      if (!textPage) return '';
      try {
        const count = m.FPDFText_CountChars(textPage);
        if (count <= 0) return '';
        return withBuffer(m, (count + 1) * 2, (ptr) => {
          m.FPDFText_GetText(textPage, 0, count, ptr);
          return m.pdfium.UTF16ToString(ptr).replace(/\r\n?/g, '\n');
        });
      } finally {
        m.FPDFText_ClosePage(textPage);
      }
    });
  }

  // Wörter einer Seite mit ihrer Lage (Vergleich). Getrennt wird an Leerraum und Zeilenenden.
  words(id: number, pageIndex: number): PageWord[] {
    const m = this.#m;
    return this.#withPage(id, pageIndex, (page) => {
      const textPage = m.FPDFText_LoadPage(page);
      if (!textPage) return [];
      try {
        const count = m.FPDFText_CountChars(textPage);
        const words: PageWord[] = [];
        let text = '';
        let rect: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        const flush = () => {
          if (text) words.push({ text, rect });
          text = '';
          rect = [Infinity, Infinity, -Infinity, -Infinity];
        };
        withBuffer(m, 32, (box) => {
          for (let i = 0; i < count; i++) {
            const code = m.FPDFText_GetUnicode(textPage, i);
            const char = code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
            if (/\s/.test(char) || code === 0xfffe) {
              flush();
              continue;
            }
            if (m.FPDFText_GetCharBox(textPage, i, box, box + 8, box + 16, box + 24)) {
              const [left, right, bottom, top] = [0, 8, 16, 24].map((offset) => m.pdfium.getValue(box + offset, 'double') as number) as [number, number, number, number];
              rect = [Math.min(rect[0], left), Math.min(rect[1], bottom), Math.max(rect[2], right), Math.max(rect[3], top)];
            }
            text += char;
          }
        });
        flush();
        return words.filter((word) => Number.isFinite(word.rect[0]));
      } finally {
        m.FPDFText_ClosePage(textPage);
      }
    });
  }
}
