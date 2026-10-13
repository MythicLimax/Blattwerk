// Seiteninhalt bearbeiten mit PDFium (Phase 5): Objekte auflisten, Text und Bilder einfügen, verschieben, skalieren,
// löschen, Textzeilen ändern. PDFium schreibt danach den Inhalt der Seite neu (FPDFPage_GenerateContent); gespeichert
// wird inkrementell. Siehe docs/entscheidungen/0010-inhalt-bearbeiten.md.
import type { Rgb } from '../../shared/annotations';
import {
  imageMatrix,
  LINE_HEIGHT,
  MAX_PAGE_OBJECTS,
  missingChars,
  type ContentOperation,
  type PageFontInfo,
  type PageObjectInfo,
  type PageObjects,
} from '../../shared/content';
import type { StampFont } from '../../shared/stamping';
import { withBuffer, withFloats, withWString, type Pdfium } from './memory';
import type { Allocations } from './pages';

export class ContentError extends Error {
  constructor(
    message: string,
    // content-characters: Zeichen, die weder die Schrift der Zeile noch eine Standardschrift kennt (message = Zeichen)
    readonly code: 'content-missing' | 'content-characters' = 'content-missing',
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

const OBJECT = { text: 1, path: 2, image: 3, shading: 4, form: 5 } as const;

// PDFium-Namen der Standardschriften
const STANDARD_FONT: Record<StampFont, string> = {
  Helvetica: 'Helvetica',
  HelveticaBold: 'Helvetica-Bold',
  TimesRoman: 'Times-Roman',
  TimesRomanBold: 'Times-Bold',
  Courier: 'Courier',
};

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

function readFloats(m: Pdfium, count: number, fill: (ptr: number) => boolean): number[] | null {
  return withBuffer(m, count * 4, (ptr) => (fill(ptr) ? Array.from({ length: count }, (_, i) => m.pdfium.getValue(ptr + i * 4, 'float') as number) : null));
}

function objectText(m: Pdfium, object: number, textPage: number): string {
  const length = m.FPDFTextObj_GetText(object, textPage, 0, 0);
  if (length <= 2) return '';
  return withBuffer(m, length, (ptr) => {
    m.FPDFTextObj_GetText(object, textPage, ptr, length);
    return m.pdfium.UTF16ToString(ptr);
  });
}

function fontName(m: Pdfium, font: number): string {
  const length = m.FPDFFont_GetBaseFontName(font, 0, 0);
  if (length <= 1) return '';
  return withBuffer(m, length + 1, (ptr) => {
    m.FPDFFont_GetBaseFontName(font, ptr, length);
    return m.pdfium.UTF8ToString(ptr);
  });
}

function fillColor(m: Pdfium, object: number): Rgb | undefined {
  return withBuffer(m, 16, (ptr) => {
    if (!m.FPDFPageObj_GetFillColor(object, ptr, ptr + 4, ptr + 8, ptr + 12)) return undefined;
    const value = (offset: number) => (m.pdfium.getValue(ptr + offset, 'i32') as number) / 255;
    return { r: value(0), g: value(4), b: value(8) };
  });
}

function withPage<T>(m: Pdfium, doc: number, pageIndex: number, fn: (page: number) => T): T {
  const page = m.FPDF_LoadPage(doc, pageIndex);
  if (!page) throw new ContentError(`Seite ${pageIndex + 1} lässt sich nicht laden`);
  try {
    return fn(page);
  } finally {
    m.FPDF_ClosePage(page);
  }
}

export function listPageObjects(m: Pdfium, doc: number, pageIndex: number): PageObjects {
  return withPage(m, doc, pageIndex, (page) => {
    const textPage = m.FPDFText_LoadPage(page);
    try {
      const objects: PageObjectInfo[] = [];
      const fontsByPointer = new Map<number, string>();
      const fonts: Record<string, PageFontInfo & { seen: Set<string>; handle: number }> = {};
      const count = m.FPDFPage_CountObjects(page);
      let truncated = false;
      for (let index = 0; index < count; index++) {
        const object = m.FPDFPage_GetObject(page, index);
        const type = m.FPDFPageObj_GetType(object);
        const kind = type === OBJECT.text ? 'text' : type === OBJECT.image ? 'image' : type === OBJECT.form ? 'form' : null;
        if (!kind) continue;
        if (objects.length >= MAX_PAGE_OBJECTS) {
          truncated = true;
          break;
        }
        const bounds = readFloats(m, 4, (ptr) => Boolean(m.FPDFPageObj_GetBounds(object, ptr, ptr + 4, ptr + 8, ptr + 12)));
        if (!bounds) continue;
        const info: PageObjectInfo = { index, kind, bounds: bounds as PageObjectInfo['bounds'] };
        if (kind === 'text') {
          const text = textPage ? objectText(m, object, textPage) : '';
          const size = readFloats(m, 1, (ptr) => Boolean(m.FPDFTextObj_GetFontSize(object, ptr)));
          const font = m.FPDFTextObj_GetFont(object);
          let key = fontsByPointer.get(font);
          if (key === undefined) {
            key = `f${fontsByPointer.size}`;
            fontsByPointer.set(font, key);
            fonts[key] = { name: fontName(m, font), embedded: Boolean(m.FPDFFont_GetIsEmbedded(font)), chars: null, seen: new Set(), handle: font };
          }
          for (const char of text) fonts[key]?.seen.add(char);
          Object.assign(info, { text, fontSize: size?.[0] ?? 0, font: key, color: fillColor(m, object) });
        }
        objects.push(info);
      }
      const result: Record<string, PageFontInfo> = {};
      for (const [key, font] of Object.entries(fonts)) {
        // Nicht eingebettete Schriften ersetzt das Anzeigeprogramm (westeuropäischer Zeichensatz). Eingebettete enthalten
        // oft nur die verwendeten Zeichen: geprüft wird, für welche Zeichen die Schrift wirklich eine Form hat.
        result[key] = { name: font.name, embedded: font.embedded, chars: font.embedded ? renderableChars(m, font.handle, font.seen) : null };
      }
      return { pageIndex, objects, fonts: result, truncated };
    } finally {
      if (textPage) m.FPDFText_ClosePage(textPage);
    }
  });
}

// Kandidaten: westeuropäischer Zeichensatz und alle Zeichen, die auf der Seite in dieser Schrift vorkommen
const CANDIDATES = (() => {
  const chars: string[] = [];
  for (let code = 0x21; code <= 0x7e; code++) chars.push(String.fromCharCode(code));
  for (let code = 0xa1; code <= 0xff; code++) chars.push(String.fromCharCode(code));
  return [...chars, ...'€‚ƒ„…†‡‰Š‹ŒŽ‘’“”•–—™š›œžŸ'];
})();

// Fehlt ein Zeichen, liefert PDFium die Form des Ersatzzeichens (.notdef, meist ein Kästchen). Dessen Form ergibt sich
// aus einem Zeichen, das keine Schrift enthält (Privatbereich von Unicode).
// PDFium hält Glyphenpfade im Zwischenspeicher je Glyphe: Alle fehlenden Zeichen liefern denselben Pfad.
function renderableChars(m: Pdfium, font: number, seen: Set<string>): string {
  const notdef = m.FPDFFont_GetGlyphPath(font, 0xf8ff, 12);
  const result: string[] = [];
  for (const char of new Set([...CANDIDATES, ...seen])) {
    if (/\s/.test(char)) continue;
    const path = m.FPDFFont_GetGlyphPath(font, char.codePointAt(0) ?? 0, 12);
    if (path && path !== notdef && m.FPDFGlyphPath_CountGlyphSegments(path) > 0) result.push(char);
  }
  return result.join('');
}

// Ähnliche Standardschrift für eine Zeile, deren Schrift die neuen Zeichen nicht hat
function substituteFont(name: string, weight: number): StampFont {
  const lower = name.toLowerCase();
  const bold = weight >= 600 || /bold|black|heavy|semibold/.test(lower);
  if (/courier|mono|consol/.test(lower)) return 'Courier';
  if (/times|serif|roman|georgia|garamond|cambria|minion/.test(lower) && !/sans/.test(lower)) return bold ? 'TimesRomanBold' : 'TimesRoman';
  return bold ? 'HelveticaBold' : 'Helvetica';
}

function newTextObject(m: Pdfium, doc: number, font: StampFont, size: number, text: string, color: Rgb): number {
  const object = m.FPDFPageObj_NewTextObj(doc, STANDARD_FONT[font], size);
  if (!object) throw new ContentError('Textobjekt lässt sich nicht anlegen');
  withWString(m, text, (ptr) => m.FPDFText_SetText(object, ptr));
  m.FPDFPageObj_SetFillColor(object, byte(color.r), byte(color.g), byte(color.b), 255);
  return object;
}

function objectAt(m: Pdfium, page: number, index: number): number {
  if (index < 0 || index >= m.FPDFPage_CountObjects(page)) throw new ContentError(`Objekt ${index} fehlt`);
  const object = m.FPDFPage_GetObject(page, index);
  if (!object) throw new ContentError(`Objekt ${index} fehlt`);
  return object;
}

// Wendet eine Inhaltsoperation an und schreibt den Inhalt der Seite neu.
export function applyContentOperation(m: Pdfium, doc: number, operation: ContentOperation, memory: Allocations): void {
  withPage(m, doc, operation.pageIndex, (page) => {
    switch (operation.type) {
      case 'addText': {
        const rotation = (m.FPDFPage_GetRotation(page) * 90) % 360;
        // Aufrecht zur Anzeige: Die Seite wird um rotation im Uhrzeigersinn gedreht angezeigt, der Text also gegenläufig gedreht.
        const angle = (rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        operation.lines.forEach((line, i) => {
          if (line === '') return;
          const object = newTextObject(m, doc, operation.font, operation.size, line, operation.color);
          // Zeile i liegt um i · Zeilenhöhe unter der ersten, in der Leserichtung der angezeigten Seite
          const offset = i * operation.size * LINE_HEIGHT;
          const x = operation.origin.x + sin * offset;
          const y = operation.origin.y - cos * offset;
          m.FPDFPageObj_Transform(object, cos, sin, -sin, cos, x, y);
          m.FPDFPage_InsertObject(page, object);
        });
        break;
      }
      case 'addImage': {
        const { image, rect } = operation;
        const object = m.FPDFPageObj_NewImageObj(doc);
        if (!object) throw new ContentError('Bildobjekt lässt sich nicht anlegen');
        const data = new Uint8Array(image.data);
        const ptr = memory.copy(data);
        const ok = image.kind === 'jpeg' ? m.EPDFImageObj_SetJpeg(0, 0, object, ptr, data.length) : m.EPDFImageObj_SetPng(0, 0, object, ptr, data.length);
        if (!ok) {
          m.FPDFPageObj_Destroy(object);
          throw new ContentError('Bild lässt sich nicht einbetten');
        }
        // Einheitsquadrat auf das Rechteck legen, EXIF-Drehung inklusive
        withFloats(m, imageMatrix(rect, image.rotation), (matrix) => m.FPDFPageObj_SetMatrix(object, matrix));
        m.FPDFPage_InsertObject(page, object);
        break;
      }
      case 'transform': {
        const object = objectAt(m, page, operation.index);
        const [a, b, c, d, e, f] = operation.matrix;
        m.FPDFPageObj_Transform(object, a, b, c, d, e, f);
        break;
      }
      case 'delete': {
        for (const index of [...new Set(operation.indices)].sort((x, y) => y - x)) {
          const object = objectAt(m, page, index);
          if (m.FPDFPage_RemoveObject(page, object)) m.FPDFPageObj_Destroy(object);
        }
        break;
      }
      case 'editText':
        replaceText(m, doc, page, operation.pageIndex, operation.index, operation.text);
        break;
    }
    if (!m.FPDFPage_GenerateContent(page)) throw new ContentError(`Seite ${operation.pageIndex + 1} lässt sich nicht neu schreiben`);
  });
}

// Text einer Zeile ersetzen. Kennt die Schrift alle Zeichen, bleibt sie; sonst wird die Zeile mit einer ähnlichen
// Standardschrift neu angelegt (gleiche Lage, Größe, Farbe und Darstellungsart).
function replaceText(m: Pdfium, doc: number, page: number, pageIndex: number, index: number, text: string): void {
  const object = objectAt(m, page, index);
  if (m.FPDFPageObj_GetType(object) !== OBJECT.text) throw new ContentError(`Objekt ${index} ist kein Text`);
  const listing = listPageObjects(m, doc, pageIndex);
  const info = listing.objects.find((entry) => entry.index === index);
  const font = info?.font ? listing.fonts[info.font] : undefined;
  if (missingChars(text, font) === '') {
    withWString(m, text, (ptr) => m.FPDFText_SetText(object, ptr));
    return;
  }
  // Die Standardschriften kennen nur den westeuropäischen Zeichensatz
  const impossible = missingChars(text, undefined);
  if (impossible) throw new ContentError(impossible, 'content-characters');
  const matrix = readFloats(m, 6, (ptr) => Boolean(m.FPDFPageObj_GetMatrix(object, ptr)));
  const size = info?.fontSize ?? 12;
  const weight = m.FPDFFont_GetWeight(m.FPDFTextObj_GetFont(object));
  const replacement = newTextObject(m, doc, substituteFont(font?.name ?? '', weight), size, text, info?.color ?? { r: 0, g: 0, b: 0 });
  m.FPDFTextObj_SetTextRenderMode(replacement, m.FPDFTextObj_GetTextRenderMode(object));
  if (matrix) withFloats(m, matrix, (ptr) => m.FPDFPageObj_SetMatrix(replacement, ptr));
  m.FPDFPage_InsertObjectAtIndex(page, replacement, index);
  if (m.FPDFPage_RemoveObject(page, object)) m.FPDFPageObj_Destroy(object);
}
