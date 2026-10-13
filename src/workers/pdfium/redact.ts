// Schwärzen mit PDFium (Phase 5). Entfernt Inhalte unter den markierten Bereichen endgültig:
//  - Text: Zeichen im Bereich werden aus dem Inhaltsstrom gelöscht (auch in Formular-XObjects),
//  - Bilder: Bildpunkte (und Transparenzmaske) im Bereich werden überschrieben,
//  - Vektorgrafik und Verläufe, die ganz im Bereich liegen, werden entfernt,
//  - Anmerkungen (Kommentare, Links, Formularfelder), die den Bereich berühren, werden gelöscht,
//  - an jeder Stelle bleibt ein schwarzes Rechteck (auch über leeren Stellen, wie in Acrobat).
// Gespeichert wird danach immer vollständig neu; sanitize.ts entfernt Reste (siehe docs/entscheidungen/0008-schwaerzen.md).
import type { RedactionArea } from '../../shared/redaction';
import { areaRects, rectContains, rectsIntersect } from '../../shared/redaction';
import type { Quad, Rect } from '../../shared/annotations';
import { withBuffer, withFloats, type Pdfium } from './memory';

export class RedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedactionError';
  }
}

// Typen von Seitenobjekten und Anmerkungen (fpdf_edit.h, fpdf_annot.h)
const OBJECT = { text: 1, path: 2, image: 3, shading: 4, form: 5 } as const;
const ANNOT_REDACT = 28;
const FILLMODE_WINDING = 2;

function readRect(m: Pdfium, read: (ptr: number) => boolean): Rect | null {
  return withBuffer(m, 16, (ptr) => {
    if (!read(ptr)) return null;
    const value = (offset: number) => m.pdfium.getValue(ptr + offset, 'float') as number;
    // FS_RECTF: links, oben, rechts, unten
    const [left, top, right, bottom] = [value(0), value(4), value(8), value(12)];
    return [Math.min(left, right), Math.min(top, bottom), Math.max(left, right), Math.max(top, bottom)];
  });
}

function objectBounds(m: Pdfium, object: number): Rect | null {
  return withBuffer(m, 16, (ptr) => {
    if (!m.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return null;
    const value = (offset: number) => m.pdfium.getValue(ptr + offset, 'float') as number;
    return [value(0), value(4), value(8), value(12)];
  });
}

// Schwärzungsmarkierungen, die schon in der Datei stehen (z. B. aus Acrobat), mit ihrer genauen Lage:
// Vierecke je Zeile (/QuadPoints) oder, ohne sie, das Rechteck.
function fileMarks(m: Pdfium, page: number): { rects: Rect[]; quads: Quad[] } {
  const rects: Rect[] = [];
  const quads: Quad[] = [];
  const count = m.FPDFPage_GetAnnotCount(page);
  for (let i = 0; i < count; i++) {
    const annot = m.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      if (m.FPDFAnnot_GetSubtype(annot) !== ANNOT_REDACT) continue;
      const points = m.FPDFAnnot_CountAttachmentPoints(annot);
      if (points > 0) {
        withBuffer(m, 32, (ptr) => {
          for (let q = 0; q < points; q++) {
            if (!m.FPDFAnnot_GetAttachmentPoints(annot, q, ptr)) continue;
            const v = (index: number) => m.pdfium.getValue(ptr + index * 4, 'float') as number;
            quads.push([
              { x: v(0), y: v(1) },
              { x: v(2), y: v(3) },
              { x: v(4), y: v(5) },
              { x: v(6), y: v(7) },
            ]);
          }
        });
      } else {
        const rect = readRect(m, (ptr) => Boolean(m.FPDFAnnot_GetRect(annot, ptr)));
        if (rect) rects.push(rect);
      }
    } finally {
      m.FPDFPage_CloseAnnot(annot);
    }
  }
  return { rects, quads };
}

// Anmerkungen, die einen Bereich berühren, samt ihrer Popups; dazu alle Schwärzungsmarkierungen (sie werden angewendet)
function removeAnnotations(m: Pdfium, page: number, rects: Rect[]): void {
  const remove = new Set<number>();
  const popups: Array<{ number: number; parent: number }> = [];
  const count = m.FPDFPage_GetAnnotCount(page);
  for (let i = 0; i < count; i++) {
    const annot = m.FPDFPage_GetAnnot(page, i);
    if (!annot) continue;
    try {
      const number = m.EPDFAnnot_GetObjectNumber(annot);
      const subtype = m.FPDFAnnot_GetSubtype(annot);
      const rect = readRect(m, (ptr) => Boolean(m.FPDFAnnot_GetRect(annot, ptr)));
      const parent = m.FPDFAnnot_GetLinkedAnnot(annot, 'Parent');
      if (parent) {
        popups.push({ number, parent: m.EPDFAnnot_GetObjectNumber(parent) });
        m.FPDFPage_CloseAnnot(parent);
      }
      if (subtype === ANNOT_REDACT || (rect && rects.some((area) => rectsIntersect(area, rect)))) remove.add(number);
    } finally {
      m.FPDFPage_CloseAnnot(annot);
    }
  }
  for (const popup of popups) if (remove.has(popup.parent)) remove.add(popup.number);
  for (const number of remove) {
    if (number > 0) m.EPDFPage_RemoveAnnotByObjectNumber(page, number);
  }
}

// Vektorgrafik, Verläufe und Bilder, die ganz in einem Bereich liegen, entfernen. (Teilweise bedeckte Bilder
// überschreibt PDFium beim Schwärzen; Text entfernt PDFium zeichenweise.) Vor dem Schwärzen, sonst träfe es auch die
// schwarzen Rechtecke.
function removeCoveredObjects(m: Pdfium, page: number, rects: Rect[]): void {
  for (let i = m.FPDFPage_CountObjects(page) - 1; i >= 0; i--) {
    const object = m.FPDFPage_GetObject(page, i);
    if (!object) continue;
    const type = m.FPDFPageObj_GetType(object);
    if (type !== OBJECT.path && type !== OBJECT.shading && type !== OBJECT.image) continue;
    const bounds = objectBounds(m, object);
    if (!bounds || !rects.some((area) => rectContains(area, bounds))) continue;
    if (m.FPDFPage_RemoveObject(page, object)) m.FPDFPageObj_Destroy(object);
  }
}

function insertBlackBox(m: Pdfium, page: number, [left, bottom, right, top]: Rect): void {
  const box = m.FPDFPageObj_CreateNewRect(left, bottom, right - left, top - bottom);
  if (!box) throw new RedactionError('Schwarzes Rechteck lässt sich nicht anlegen');
  m.FPDFPageObj_SetFillColor(box, 0, 0, 0, 255);
  m.FPDFPath_SetDrawMode(box, FILLMODE_WINDING, false);
  m.FPDFPage_InsertObject(page, box);
}

export function applyRedactions(m: Pdfium, doc: number, areas: RedactionArea[]): void {
  for (const requested of areas) {
    const page = m.FPDF_LoadPage(doc, requested.pageIndex);
    if (!page) throw new RedactionError(`Seite ${requested.pageIndex + 1} lässt sich nicht laden`);
    try {
      const fromFile = fileMarks(m, page);
      const area: RedactionArea = {
        pageIndex: requested.pageIndex,
        rects: [...requested.rects, ...fromFile.rects],
        quads: [...requested.quads, ...fromFile.quads],
      };
      const rects = areaRects(area);
      if (rects.length === 0) continue;
      removeAnnotations(m, page, rects);
      removeCoveredObjects(m, page, rects);
      // Rückgabe false heißt nur „nichts gefunden“ (z. B. leere Stelle); das ist kein Fehler.
      for (const [left, bottom, right, top] of area.rects) {
        withFloats(m, [left, top, right, bottom], (ptr) => m.EPDFText_RedactInRect(page, ptr, true, false));
      }
      if (area.quads.length > 0) {
        const floats = area.quads.flatMap((quad) => quad.flatMap((point) => [point.x, point.y]));
        withFloats(m, floats, (ptr) => m.EPDFText_RedactInQuads(page, ptr, area.quads.length, true, false));
      }
      for (const rect of rects) insertBlackBox(m, page, rect);
      if (!m.FPDFPage_GenerateContent(page)) throw new RedactionError(`Seite ${area.pageIndex + 1} lässt sich nicht neu schreiben`);
    } finally {
      m.FPDF_ClosePage(page);
    }
  }
}
