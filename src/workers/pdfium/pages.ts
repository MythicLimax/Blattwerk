// Seitenoperationen mit PDFium (Phase 3): drehen, löschen, verschieben, einfügen, neue Dokumente zusammensetzen.
// Wird nur von engine.ts aufgerufen; Puffer, die PDFium noch braucht, leben bis nach dem Speichern.
import { imagePageLayout } from '../../shared/image-info';
import { marginsToUser, MIN_CROPPED_SIZE, type ComposePart, type ImageSource, type Margins, type PageOperation, type PdfSource } from '../../shared/pages';
import { withBuffer, type Pdfium } from './memory';

// Fehlercodes von FPDF_GetLastError
const ERR_PASSWORD = 4;

export class PageOperationError extends Error {
  constructor(
    // Schlüssel für die Fehlermeldung in der Oberfläche (errors.pages.*)
    readonly code: 'password' | 'invalid' | 'range' | 'all-pages' | 'image' | 'import' | 'crop-too-small',
    message: string,
  ) {
    super(message);
    this.name = 'PageOperationError';
  }
}

// Reserviert Speicher, der bis zum Aufruf von release() gültig bleibt (PDFium liest manche Daten erst beim Speichern).
export class Allocations {
  readonly #m: Pdfium;
  readonly #ptrs: number[] = [];
  readonly #docs: number[] = [];

  constructor(m: Pdfium) {
    this.#m = m;
  }

  copy(data: Uint8Array): number {
    const ptr = this.#m.pdfium.wasmExports.malloc(Math.max(1, data.length));
    if (!ptr) throw new Error('PDFium: kein Speicher');
    this.#m.pdfium.HEAPU8.set(data, ptr);
    this.#ptrs.push(ptr);
    return ptr;
  }

  ints(values: number[]): number {
    const ptr = this.#m.pdfium.wasmExports.malloc(Math.max(4, values.length * 4));
    if (!ptr) throw new Error('PDFium: kein Speicher');
    values.forEach((value, i) => this.#m.pdfium.setValue(ptr + i * 4, value, 'i32'));
    this.#ptrs.push(ptr);
    return ptr;
  }

  // Öffnet ein Quelldokument; es bleibt bis release() offen.
  openDocument(source: PdfSource): number {
    const data = new Uint8Array(source.data);
    const ptr = this.copy(data);
    const doc = this.#m.FPDF_LoadMemDocument(ptr, data.length, source.password ?? '');
    if (!doc) {
      const error = this.#m.FPDF_GetLastError();
      throw error === ERR_PASSWORD
        ? new PageOperationError('password', 'Kennwort für das Quelldokument fehlt oder ist falsch')
        : new PageOperationError('invalid', `Quelldokument lässt sich nicht öffnen (Fehler ${error})`);
    }
    this.#docs.push(doc);
    return doc;
  }

  release(): void {
    for (const doc of this.#docs.splice(0)) this.#m.FPDF_CloseDocument(doc);
    for (const ptr of this.#ptrs.splice(0)) this.#m.pdfium.wasmExports.free(ptr);
  }
}

// Prüft Seitenangaben; Doppelte entfallen. Sortiert, außer die Reihenfolge ist gewollt (Übernehmen aus anderen PDFs).
function checkPages(pages: number[], pageCount: number, keepOrder = false): number[] {
  const unique = [...new Set(pages)];
  if (unique.length === 0 || unique.some((p) => !Number.isInteger(p) || p < 0 || p >= pageCount)) {
    throw new PageOperationError('range', `Ungültige Seiten: ${pages.join(', ')}`);
  }
  return keepOrder ? unique : unique.sort((a, b) => a - b);
}

function checkPosition(at: number, pageCount: number): number {
  if (!Number.isInteger(at) || at < 0 || at > pageCount) throw new PageOperationError('range', `Ungültige Position: ${at}`);
  return at;
}

function insertImage(m: Pdfium, doc: number, at: number, image: ImageSource, memory: Allocations): void {
  const layout = imagePageLayout(image);
  const page = m.FPDFPage_New(doc, at, layout.width, layout.height);
  if (!page) throw new PageOperationError('image', 'Neue Seite für das Bild lässt sich nicht anlegen');
  try {
    const object = m.FPDFPageObj_NewImageObj(doc);
    const data = new Uint8Array(image.data);
    const ptr = memory.copy(data);
    const loaded =
      image.kind === 'jpeg'
        ? m.EPDFImageObj_SetJpeg(0, 0, object, ptr, data.length)
        : m.EPDFImageObj_SetPng(0, 0, object, ptr, data.length);
    if (!loaded) {
      m.FPDFPageObj_Destroy(object);
      throw new PageOperationError('image', 'Bild lässt sich nicht einbetten');
    }
    const [a, b, c, d, e, f] = layout.matrix;
    m.FPDFImageObj_SetMatrix(object, a, b, c, d, e, f);
    m.FPDFPage_InsertObject(page, object);
    if (!m.FPDFPage_GenerateContent(page)) throw new PageOperationError('image', 'Seiteninhalt lässt sich nicht erzeugen');
  } finally {
    m.FPDF_ClosePage(page);
  }
}

// Schneidet eine Seite zu: sichtbarer Bereich (CropBox) wird um die Ränder kleiner; der Inhalt bleibt erhalten
function cropPage(m: Pdfium, doc: number, index: number, margins: Margins): void {
  const page = m.FPDF_LoadPage(doc, index);
  if (!page) throw new PageOperationError('range', `Seite ${index + 1} lässt sich nicht laden`);
  try {
    const read = (fn: 'FPDFPage_GetCropBox' | 'FPDFPage_GetMediaBox') =>
      withBuffer(m, 16, (ptr) => (m[fn](page, ptr, ptr + 4, ptr + 8, ptr + 12) ? [0, 4, 8, 12].map((offset) => m.pdfium.getValue(ptr + offset, 'float') as number) : null));
    const [l = 0, b = 0, r = 0, t = 0] = read('FPDFPage_GetCropBox') ?? read('FPDFPage_GetMediaBox') ?? [];
    const rotation = ((m.FPDFPage_GetRotation(page) % 4) * 90) as 0 | 90 | 180 | 270;
    const user = marginsToUser(margins, rotation);
    const left = Math.min(l, r) + user.left;
    const right = Math.max(l, r) - user.right;
    const bottom = Math.min(b, t) + user.bottom;
    const top = Math.max(b, t) - user.top;
    if (right - left < MIN_CROPPED_SIZE || top - bottom < MIN_CROPPED_SIZE) throw new PageOperationError('crop-too-small', `Seite ${index + 1} wäre zu klein`);
    m.FPDFPage_SetCropBox(page, left, bottom, right, top);
  } finally {
    m.FPDF_ClosePage(page);
  }
}

// Wendet eine Operation auf ein geöffnetes Dokument an.
export function applyPageOperation(m: Pdfium, doc: number, op: PageOperation, memory: Allocations): void {
  const pageCount = m.FPDF_GetPageCount(doc);
  switch (op.type) {
    case 'rotate': {
      const steps = op.delta / 90;
      for (const index of checkPages(op.pages, pageCount)) {
        const page = m.FPDF_LoadPage(doc, index);
        if (!page) throw new PageOperationError('range', `Seite ${index + 1} lässt sich nicht laden`);
        try {
          m.FPDFPage_SetRotation(page, (m.FPDFPage_GetRotation(page) + steps) % 4);
        } finally {
          m.FPDF_ClosePage(page);
        }
      }
      return;
    }
    case 'delete': {
      const pages = checkPages(op.pages, pageCount);
      if (pages.length >= pageCount) throw new PageOperationError('all-pages', 'Mindestens eine Seite muss bleiben');
      // Von hinten löschen, damit die übrigen Nummern stimmen
      for (const index of pages.reverse()) m.FPDFPage_Delete(doc, index);
      return;
    }
    case 'move': {
      const pages = checkPages(op.pages, pageCount);
      const to = op.to;
      if (!Number.isInteger(to) || to < 0 || to > pageCount - pages.length) throw new PageOperationError('range', `Ungültiges Ziel: ${to}`);
      if (!m.FPDF_MovePages(doc, memory.ints(pages), pages.length, to)) {
        throw new PageOperationError('range', 'Seiten lassen sich nicht verschieben');
      }
      return;
    }
    case 'insertBlank': {
      const at = checkPosition(op.at, pageCount);
      if (!(op.width > 0 && op.height > 0 && op.width <= 14400 && op.height <= 14400) || !(op.count >= 1 && op.count <= 1000)) {
        throw new PageOperationError('range', 'Ungültige Seitengröße oder Anzahl');
      }
      for (let k = 0; k < op.count; k++) {
        const page = m.FPDFPage_New(doc, at + k, op.width, op.height);
        if (!page) throw new PageOperationError('range', 'Leere Seite lässt sich nicht anlegen');
        m.FPDF_ClosePage(page);
      }
      return;
    }
    case 'insertPdf': {
      const at = checkPosition(op.at, pageCount);
      importPdf(m, doc, op.source, at, memory);
      return;
    }
    case 'insertImages': {
      const at = checkPosition(op.at, pageCount);
      op.images.forEach((image, k) => insertImage(m, doc, at + k, image, memory));
      return;
    }
    case 'crop': {
      const values = [op.margins.top, op.margins.right, op.margins.bottom, op.margins.left];
      if (values.some((v) => !Number.isFinite(v) || v < 0)) throw new PageOperationError('range', 'Ungültige Ränder');
      for (const index of checkPages(op.pages, pageCount)) cropPage(m, doc, index, op.margins);
      return;
    }
  }
}

function importPdf(m: Pdfium, doc: number, source: PdfSource, at: number, memory: Allocations): void {
  const src = memory.openDocument(source);
  const sourceCount = m.FPDF_GetPageCount(src);
  const pages = source.pages === null ? null : checkPages(source.pages, sourceCount, true);
  const ok = pages
    ? m.FPDF_ImportPagesByIndex(doc, src, memory.ints(pages), pages.length, at)
    : m.FPDF_ImportPagesByIndex(doc, src, 0, 0, at);
  if (!ok) throw new PageOperationError('import', 'Seiten lassen sich nicht übernehmen');
}

// Setzt ein neues Dokument aus Teilen zusammen. Liefert das geöffnete Dokument (Aufrufer speichert und schließt).
export function composeDocument(m: Pdfium, parts: ComposePart[], memory: Allocations): number {
  const doc = m.FPDF_CreateNewDocument();
  if (!doc) throw new Error('PDFium: neues Dokument lässt sich nicht anlegen');
  try {
    for (const part of parts) {
      const at = m.FPDF_GetPageCount(doc);
      if (part.type === 'pdf') importPdf(m, doc, part.source, at, memory);
      else insertImage(m, doc, at, part.image, memory);
    }
    if (m.FPDF_GetPageCount(doc) === 0) throw new PageOperationError('range', 'Das neue Dokument hätte keine Seiten');
    return doc;
  } catch (error) {
    m.FPDF_CloseDocument(doc);
    throw error;
  }
}

// Seitenzahl eines Dokuments, oder warum es sich nicht öffnen lässt.
export function inspectDocument(
  m: Pdfium,
  data: Uint8Array,
  password: string | null,
): { ok: true; pageCount: number } | { ok: false; reason: 'password' | 'invalid' } {
  const memory = new Allocations(m);
  try {
    const doc = memory.openDocument({ data: data.slice().buffer as ArrayBuffer, password, pages: null });
    return { ok: true, pageCount: m.FPDF_GetPageCount(doc) };
  } catch (error) {
    return { ok: false, reason: error instanceof PageOperationError && error.code === 'password' ? 'password' : 'invalid' };
  } finally {
    memory.release();
  }
}
