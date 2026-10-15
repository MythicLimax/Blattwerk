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
  type ParagraphStyle,
  type TextMark,
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
          const fontSize = size?.[0] ?? 0;
          const matrix = readFloats(m, 6, (ptr) => Boolean(m.FPDFPageObj_GetMatrix(object, ptr)));
          const scale = matrix ? Math.hypot(matrix[2] ?? 0, matrix[3] ?? 0) : 1;
          const upright = matrix !== null && (matrix[0] ?? 0) > 0 && (matrix[3] ?? 0) > 0 && Math.abs(matrix[1] ?? 0) < 1e-3 && Math.abs(matrix[2] ?? 0) < 1e-3;
          const mark = readMark(m, object);
          Object.assign(info, { text, fontSize, visualSize: fontSize * (scale || 1), font: key, color: fillColor(m, object), upright, ...(upright ? { baseline: matrix[5] } : {}), ...(mark ? { mark } : {}) });
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
  // Vorher auflisten: Ein zweites Laden derselben Seite, während sie offen ist, macht Schrift-Handles ungültig
  const listing = operation.type === 'editParagraph' ? listPageObjects(m, doc, operation.pageIndex) : null;
  withPage(m, doc, operation.pageIndex, (page) => {
    switch (operation.type) {
      case 'addText': {
        const rotation = (m.FPDFPage_GetRotation(page) * 90) % 360;
        // Aufrecht zur Anzeige: Die Seite wird um rotation im Uhrzeigersinn gedreht angezeigt, der Text also gegenläufig gedreht.
        const angle = (rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        let lines: WrappedLine[] = operation.lines.map((text) => ({ text, hard: true }));
        if (operation.width) {
          // In der gewählten Breite umbrechen, gemessen in der Schrift des neuen Textes
          const ruler = newTextObject(m, doc, operation.font, operation.size, 'x', operation.color);
          try {
            const widthOf = measureWith(m, ruler, 1, 1);
            const width = operation.width;
            lines = wrapText(operation.lines.join('\n'), (line) => widthOf(line) <= width + 0.5);
          } finally {
            m.FPDFPageObj_Destroy(ruler);
          }
        }
        const paragraph = newParagraphId();
        lines.forEach((line, i) => {
          if (line.text === '') return;
          const object = newTextObject(m, doc, operation.font, operation.size, line.text, operation.color);
          writeMark(m, doc, object, { p: paragraph, ...(operation.width ? { w: operation.width } : {}), ...(line.hard ? { h: true } : {}) });
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
      case 'editText': {
        // Erst den Text ins erste Stück schreiben (behält seine Lage in der Objektliste), dann die übrigen Stücke der
        // Zeile von hinten entfernen, damit die Positionen davor gültig bleiben
        replaceText(m, doc, page, operation.pageIndex, operation.index, operation.text);
        for (const index of [...new Set(operation.merge ?? [])].filter((i) => i !== operation.index).sort((x, y) => y - x)) {
          const object = objectAt(m, page, index);
          if (m.FPDFPage_RemoveObject(page, object)) m.FPDFPageObj_Destroy(object);
        }
        break;
      }
      case 'editParagraph':
        if (listing) setParagraph(m, doc, page, listing, operation.lines, operation.text, operation.box, operation.style);
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

function removeObject(m: Pdfium, page: number, object: number): void {
  if (m.FPDFPage_RemoveObject(page, object)) m.FPDFPageObj_Destroy(object);
}

// Bricht Text in Zeilen um: harte Umbrüche (\n) bleiben, sonst Wort für Wort, solange die Zeile in ihre Breite passt.
// Ein Wort, das allein nicht passt, steht in einer eigenen Zeile. Leere Zeilen am Ende entfallen.
interface WrappedLine {
  text: string;
  // Zeile endet mit einem harten Umbruch (Absatzende oder Eingabetaste)
  hard: boolean;
}

function wrapText(text: string, fits: (line: string, index: number) => boolean): WrappedLine[] {
  const out: WrappedLine[] = [];
  for (const block of text.split('\n')) {
    const words = block.split(/[ \t]+/).filter((word) => word !== '');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || fits(candidate, out.length)) current = candidate;
      else {
        out.push({ text: current, hard: false });
        current = word;
      }
    }
    out.push({ text: current, hard: true });
  }
  while (out.length > 0 && out[out.length - 1]?.text === '') out.pop();
  return out;
}

// Eigene Kennzeichnung gesetzter Texte (Marked Content): Absatz, Breite, harter Umbruch. So bleibt ein Textfeld beim
// erneuten Öffnen ein Absatz, egal wie schmal es ist, und behält seine Breite und Umbrüche.
const MARK = 'BlattwerkText';

function markName(m: Pdfium, mark: number): string {
  return withBuffer(m, 4, (lengthPtr) => {
    if (!m.FPDFPageObjMark_GetName(mark, 0, 0, lengthPtr)) return '';
    const length = m.pdfium.getValue(lengthPtr, 'i32') as number;
    if (length <= 2) return '';
    return withBuffer(m, length, (buffer) => {
      m.FPDFPageObjMark_GetName(mark, buffer, length, lengthPtr);
      return m.pdfium.UTF16ToString(buffer);
    });
  });
}

function ownMark(m: Pdfium, object: number): number | null {
  const count = m.FPDFPageObj_CountMarks(object);
  for (let i = 0; i < count; i++) {
    const mark = m.FPDFPageObj_GetMark(object, i);
    if (mark && markName(m, mark) === MARK) return mark;
  }
  return null;
}

function readMark(m: Pdfium, object: number): TextMark | undefined {
  const mark = ownMark(m, object);
  if (!mark) return undefined;
  const int = (key: string) => withBuffer(m, 4, (ptr) => (m.FPDFPageObjMark_GetParamIntValue(mark, key, ptr) ? (m.pdfium.getValue(ptr, 'i32') as number) : null));
  const p = int('P');
  if (p === null) return undefined;
  const w = withBuffer(m, 4, (ptr) => (m.FPDFPageObjMark_GetParamFloatValue(mark, 'W', ptr) ? (m.pdfium.getValue(ptr, 'float') as number) : null));
  return { p, ...(w !== null && w > 0 ? { w } : {}), ...(int('H') === 1 ? { h: true } : {}) };
}

function writeMark(m: Pdfium, doc: number, object: number, value: TextMark): void {
  for (let mark = ownMark(m, object); mark; mark = ownMark(m, object)) if (!m.FPDFPageObj_RemoveMark(object, mark)) break;
  const mark = m.FPDFPageObj_AddMark(object, MARK);
  if (!mark) return;
  m.FPDFPageObjMark_SetIntParam(doc, object, mark, 'P', value.p);
  if (value.w) m.FPDFPageObjMark_SetFloatParam(doc, object, mark, 'W', value.w);
  if (value.h) m.FPDFPageObjMark_SetIntParam(doc, object, mark, 'H', 1);
}

// Kennzahl eines neuen Absatzes (nur innerhalb der Seite von Bedeutung)
const newParagraphId = () => 1 + Math.floor(Math.random() * 2 ** 30);

// Breite eines Textes in Seiteneinheiten, gemessen mit einem nicht eingefügten Objekt (Ursprung 0, nur Skalierung).
// PDFium stürzt bei leerem Text in neu angelegten Objekten ab; gemessen wird deshalb nie ein leerer Text.
function measureWith(m: Pdfium, ruler: number, scaleX: number, scaleY: number): (value: string) => number {
  withFloats(m, [scaleX, 0, 0, scaleY, 0, 0], (ptr) => m.FPDFPageObj_SetMatrix(ruler, ptr));
  return (value) => {
    if (value === '') return 0;
    withWString(m, value, (ptr) => m.FPDFText_SetText(ruler, ptr));
    return readFloats(m, 4, (ptr) => Boolean(m.FPDFPageObj_GetBounds(ruler, ptr, ptr + 4, ptr + 8, ptr + 12)))?.[2] ?? 0;
  };
}

// Absatz oder Zeile neu setzen (ContentOperation editParagraph). Ohne Angaben behalten die Zeilen Schrift, Größe,
// Farbe, linken Rand, Breite und Zeilenabstand; umgebrochen wird mit den echten Zeichenbreiten der Schrift.
// box ändert linken und rechten Rand (die erste Zeile behält ihren Einzug), style Größe, Schrift oder Farbe. Neue
// Größe oder Schrift erfordern neue Textobjekte (PDFium kann sie an vorhandenen nicht ändern); die Oberkante bleibt.
// Kennt die Schrift nicht alle Zeichen, bekommt der ganze Absatz eine ähnliche Standardschrift.
function setParagraph(
  m: Pdfium,
  doc: number,
  page: number,
  listing: PageObjects,
  lines: number[][],
  text: string,
  box: { left: number; right: number } | undefined,
  style: ParagraphStyle | undefined,
): void {
  if (lines.length === 0 || lines.some((line) => line.length === 0)) throw new ContentError('Absatz ohne Zeilen');
  const infos = new Map(listing.objects.map((info) => [info.index, info]));
  // Erst alle Objekte holen: Nach dem Entfernen gelten die Positionen in der Objektliste nicht mehr
  const groups = lines.map((members) =>
    members.map((index) => {
      const object = objectAt(m, page, index);
      if (m.FPDFPageObj_GetType(object) !== OBJECT.text) throw new ContentError(`Objekt ${index} ist kein Text`);
      return object;
    }),
  );
  const anchors = groups.map((group) => group[0] as number);
  const matrices = anchors.map((anchor) => readFloats(m, 6, (ptr) => Boolean(m.FPDFPageObj_GetMatrix(anchor, ptr))));
  if (matrices.some((matrix) => !matrix || Math.abs(matrix[1] ?? 0) > 1e-3 || Math.abs(matrix[2] ?? 0) > 1e-3 || (matrix[0] ?? 0) <= 0)) {
    throw new ContentError('Absatz ist gedreht');
  }
  const [first, ...rest] = matrices as number[][];
  const firstInfo = infos.get(lines[0]?.[0] ?? -1);
  if (!first || !firstInfo) throw new ContentError('Absatz fehlt');
  const members = lines.flat().map((index) => infos.get(index)?.bounds);
  const oldLeft = Math.min(...members.map((bounds) => bounds?.[0] ?? Infinity));
  const oldRight = Math.max(...members.map((bounds) => bounds?.[2] ?? -Infinity));
  const visual = firstInfo.visualSize ?? firstInfo.fontSize ?? 12;
  const factor = style?.size && visual > 0 ? style.size / visual : 1;
  const firstX = first[4] ?? 0;
  const restX = rest[0]?.[4] ?? firstX;
  const indent = firstX - restX;
  // box gilt für die sichtbaren Ränder; die Zeilen beginnen um denselben Betrag verschoben
  const left = box ? restX + (box.left - oldLeft) : restX;
  const ownWidth = firstInfo.mark?.w;
  const right = box ? box.right : ownWidth ? restX + ownWidth : oldRight;
  const x = (i: number) => (box ? left + (i === 0 ? Math.max(0, indent) : 0) : i === 0 ? firstX : restX);
  const lastY = (matrices[matrices.length - 1] as number[])[5] ?? 0;
  const gap = (lines.length > 1 ? ((first[5] ?? 0) - lastY) / (lines.length - 1) : visual * LINE_HEIGHT) * factor;
  if (!(gap > 0)) throw new ContentError('Zeilenabstand unbekannt');
  // Oberkante bleibt: Grundlinie um die Änderung der Oberlänge verschieben
  const firstY = (first[5] ?? 0) - 0.8 * visual * (factor - 1);

  const font = firstInfo.font ? listing.fonts[firstInfo.font] : undefined;
  const substitute = !style?.font && missingChars(text, font) !== '';
  if (substitute || style?.font) {
    const impossible = missingChars(text, undefined);
    if (impossible) throw new ContentError(impossible, 'content-characters');
  }
  const size = (firstInfo.fontSize ?? 12) * factor;
  const color = style?.color ?? firstInfo.color ?? { r: 0, g: 0, b: 0 };
  const originalFont = m.FPDFTextObj_GetFont(anchors[0] as number);
  const renderMode = m.FPDFTextObj_GetTextRenderMode(anchors[0] as number);
  const standard = style?.font ?? (substitute ? substituteFont(font?.name ?? '', m.FPDFFont_GetWeight(originalFont)) : null);
  // Vorhandene Objekte nur weiterverwenden, wenn Schrift und Größe bleiben
  const reuse = !standard && factor === 1;
  const make = (value: string): number => {
    let object: number;
    if (standard) object = newTextObject(m, doc, standard, size, value, color);
    else {
      object = m.FPDFPageObj_CreateTextObj(doc, originalFont, size);
      if (!object) throw new ContentError('Textobjekt lässt sich nicht anlegen');
      withWString(m, value, (ptr) => m.FPDFText_SetText(object, ptr));
      m.FPDFPageObj_SetFillColor(object, byte(color.r), byte(color.g), byte(color.b), 255);
    }
    m.FPDFTextObj_SetTextRenderMode(object, renderMode);
    return object;
  };
  const place = (object: number, matrix: number[]) => withFloats(m, matrix, (ptr) => m.FPDFPageObj_SetMatrix(object, ptr));
  const matrixFor = (i: number): number[] => {
    // Unverändert: die eigene Lage der Zeile (genau wie vorher)
    const own = matrices[i];
    if (own && !box && factor === 1) return own;
    return [first[0] ?? 1, 0, 0, first[3] ?? 1, x(i), firstY - i * gap];
  };

  const ruler = make('x');
  let out: WrappedLine[];
  try {
    const widthOf = measureWith(m, ruler, first[0] ?? 1, first[3] ?? 1);
    out = wrapText(text, (line, i) => x(i) + widthOf(line) <= right + 0.5);
  } finally {
    m.FPDFPageObj_Destroy(ruler);
  }

  const paragraph = firstInfo.mark?.p ?? newParagraphId();
  const mark = (line: WrappedLine): TextMark => ({ p: paragraph, w: right - left, ...(line.hard ? { h: true } : {}) });
  groups.forEach((group, i) => {
    const line = out[i];
    const keepAnchor = reuse && line !== undefined && line.text !== '';
    group.forEach((object, j) => {
      if (j === 0 && keepAnchor) {
        withWString(m, line.text, (ptr) => m.FPDFText_SetText(object, ptr));
        writeMark(m, doc, object, mark(line));
        place(object, matrixFor(i));
        if (style?.color) m.FPDFPageObj_SetFillColor(object, byte(color.r), byte(color.g), byte(color.b), 255);
      } else removeObject(m, page, object);
    });
  });
  out.forEach((line, i) => {
    if (line.text === '' || (reuse && i < anchors.length)) return;
    const object = make(line.text);
    writeMark(m, doc, object, mark(line));
    place(object, matrixFor(i));
    m.FPDFPage_InsertObject(page, object);
  });
}
