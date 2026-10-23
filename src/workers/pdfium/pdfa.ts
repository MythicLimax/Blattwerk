// PDF/A-2b erzeugen und prüfen (Phase 7, ADR 0017) mit @cantoo/pdf-lib. Erwartet ein unverschlüsseltes, vollständig
// geschriebenes Dokument (PDFium übernimmt vorher Kommentare und Formularwerte und entfernt einen Kennwortschutz).
//
// Erzeugen behebt, was sich ohne Neuzeichnen beheben lässt:
// - Standardschriften (Helvetica, Times, Courier, Symbol, ZapfDingbats samt Arial/Times New Roman) ohne eingebettete
//   Schrift bekommen die in PDFium eingebaute Schrift (CFF, BSD) mit genau passenden Breiten.
// - Ausgabebedingung sRGB, bei CMYK-Farben zusätzlich DefaultCMYK mit einem CMYK-Profil.
// - XMP-Metadaten mit PDF/A-Kennung, passend zu den Dokumentinformationen; Dokument-ID.
// - Entfernt: JavaScript, eingebettete Dateien, Zusatzaktionen und unzulässige Aktionen, XFA, Ton/Film/3D-Anmerkungen,
//   Transferfunktionen; Anmerkungen werden druckbar und sichtbar; LZW wird zu Flate; Bildglättung aus.
// Was sich nicht beheben lässt (nicht eingebettete andere Schriften), meldet ein Fehler mit den Namen.
//
// Prüfen meldet dieselben Regeln, ohne etwas zu ändern. Das ersetzt keinen vollständigen Prüfer wie veraPDF.
import { decodePDFRawStream, PDFArray, PDFBool, PDFDict, PDFDocument, PDFHeader, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import { Encodings, Font } from '@cantoo/pdf-lib/standard-fonts';
import type { PdfAIssue, PdfAReport } from '../../shared/pdfa';
import { cffWidths } from './cff';
import { MAC_ROMAN_ENCODING, STANDARD_ENCODING } from './font-tables';
import { srgbProfile } from './icc';

export type StandardFontName =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic'
  | 'Courier'
  | 'Courier-Bold'
  | 'Courier-Oblique'
  | 'Courier-BoldOblique'
  | 'Symbol'
  | 'ZapfDingbats';

export interface PdfAResources {
  // Schriftprogramm (CFF) einer Standardschrift, aus PDFium
  standardFont: (name: StandardFontName) => Uint8Array;
  // Schrift des Rechners (TrueType) für einen nicht eingebetteten Schriftnamen, von der Oberfläche gesucht (ADR 0024)
  systemFont?: (baseFont: string) => Uint8Array | null;
  // CMYK-Profil für DefaultCMYK (null: CMYK-Farben lassen sich nicht umwandeln)
  cmykProfile: Uint8Array | null;
}

export class PdfAError extends Error {
  constructor(
    readonly code: 'pdfa-fonts' | 'pdfa-cmyk',
    detail: string,
  ) {
    super(detail);
    this.name = 'PdfAError';
  }
}

const N = (name: string) => PDFName.of(name);
const FORBIDDEN_ACTIONS = new Set(['Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'JavaScript']);
const FORBIDDEN_ANNOTATIONS = new Set(['Sound', 'Movie', 'Screen', '3D', 'RichMedia', 'FileAttachment']);
// Anmerkungsflags: unsichtbar 1, versteckt 2, drucken 4, nicht anzeigen 32, Anzeige umschaltbar 256
const FLAG = { invisible: 1, hidden: 2, print: 4, noView: 32, toggleNoView: 256 } as const;

const nameOf = (value: PDFObject | undefined): string | null => (value instanceof PDFName ? value.decodeText() : null);

// Alle Wörterbücher und Ströme des Dokuments, auch direkt eingebettete, jeweils einmal
function* allDicts(doc: PDFDocument): Generator<PDFDict> {
  const seen = new Set<PDFObject>();
  const stack: PDFObject[] = doc.context.enumerateIndirectObjects().map(([, object]) => object);
  stack.push(doc.context.trailerInfo.Root as PDFObject);
  while (stack.length > 0) {
    const object = stack.pop() as PDFObject;
    if (seen.has(object)) continue;
    seen.add(object);
    const dict = object instanceof PDFStream ? object.dict : object instanceof PDFDict ? object : null;
    if (dict) {
      yield dict;
      for (const [, value] of dict.entries()) if (!(value instanceof PDFRef)) stack.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) if (!(value instanceof PDFRef)) stack.push(value);
    }
  }
}

function allStreams(doc: PDFDocument): Array<[PDFRef, PDFRawStream]> {
  return doc.context
    .enumerateIndirectObjects()
    .filter((entry): entry is [PDFRef, PDFRawStream] => entry[1] instanceof PDFRawStream);
}

const filters = (dict: PDFDict, doc: PDFDocument): string[] => {
  const filter = dict.lookup(N('Filter'));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) return filter.asArray().map((item) => nameOf(doc.context.lookup(item)) ?? '');
  return [];
};

// ——— Schriften ———

function fontFile(doc: PDFDocument, font: PDFDict): boolean {
  const descriptor = font.lookup(N('FontDescriptor'));
  return descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(N(key)));
}

// Ersatz unter den Standardschriften für einen nicht eingebetteten Schriftnamen (oder null)
export function standardFor(baseFont: string): StandardFontName | null {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '').replace(/[\s_]/g, '');
  const bold = /bold|black|heavy|semibold|demi/i.test(name);
  const italic = /italic|oblique|kursiv/i.test(name);
  if (/^symbol/i.test(name)) return 'Symbol';
  if (/zapf|dingbat/i.test(name)) return 'ZapfDingbats';
  if (/^courier/i.test(name)) return bold && italic ? 'Courier-BoldOblique' : bold ? 'Courier-Bold' : italic ? 'Courier-Oblique' : 'Courier';
  if (/^times/i.test(name)) return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman';
  if (/^(helvetica|arial)/i.test(name)) return bold && italic ? 'Helvetica-BoldOblique' : bold ? 'Helvetica-Bold' : italic ? 'Helvetica-Oblique' : 'Helvetica';
  return null;
}

const WIN_ANSI: string[] = (() => {
  const table = new Array<string>(256).fill('');
  for (const codePoint of Encodings.WinAnsi.supportedCodePoints) {
    const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint);
    if (!table[code]) table[code] = name;
  }
  return table;
})();

const builtIn = (encoding: typeof Encodings.Symbol): string[] => {
  const table = new Array<string>(256).fill('');
  for (const codePoint of encoding.supportedCodePoints) {
    const { code, name } = encoding.encodeUnicodeCodePoint(codePoint);
    if (!table[code]) table[code] = name;
  }
  return table;
};

// Zeichencode → Glyphenname nach /Encoding der Schrift
function encodingOf(doc: PDFDocument, font: PDFDict, standard: StandardFontName): string[] {
  const symbolic = standard === 'Symbol' || standard === 'ZapfDingbats';
  const base = symbolic ? builtIn(standard === 'Symbol' ? Encodings.Symbol : Encodings.ZapfDingbats) : STANDARD_ENCODING;
  const encoding = font.lookup(N('Encoding'));
  const named = (name: string | null) => (name === 'WinAnsiEncoding' ? WIN_ANSI : name === 'MacRomanEncoding' ? MAC_ROMAN_ENCODING : name === 'StandardEncoding' ? STANDARD_ENCODING : null);
  if (encoding instanceof PDFName) return [...(named(encoding.decodeText()) ?? base)];
  if (!(encoding instanceof PDFDict)) return [...base];
  const table = [...(named(nameOf(encoding.lookup(N('BaseEncoding')))) ?? base)];
  const differences = encoding.lookup(N('Differences'));
  if (differences instanceof PDFArray) {
    let code = 0;
    for (const item of differences.asArray()) {
      const value = doc.context.lookup(item);
      if (value instanceof PDFNumber) code = value.asNumber();
      else if (value instanceof PDFName && code < 256) table[code++] = value.decodeText();
    }
  }
  return table;
}

// Glyphenname → Unicode für die üblichen Kodierungen der einfachen Schriften
const GLYPH_UNICODE: Map<string, number> = (() => {
  const map = new Map<string, number>();
  for (const encoding of [Encodings.WinAnsi, Encodings.Symbol]) {
    for (const codePoint of encoding.supportedCodePoints) {
      const { name } = encoding.encodeUnicodeCodePoint(codePoint);
      if (!map.has(name)) map.set(name, codePoint);
    }
  }
  return map;
})();

// Nicht eingebettete einfache Schrift durch eine Schrift des Rechners ersetzen (TrueType, als FontFile2). Breiten aus
// dem Schriftprogramm, damit Prüfer (veraPDF) sie mit dem Programm übereinstimmend finden.
async function embedTrueTypeFont(doc: PDFDocument, font: PDFDict, program: Uint8Array): Promise<void> {
  const fontkit = (await import('@cantoo/fontkit')).default;
  const parsed = fontkit.create(program) as unknown as {
    unitsPerEm: number;
    postscriptName: string;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
    italicAngle: number;
    ascent: number;
    descent: number;
    capHeight: number;
    glyphForCodePoint: (codePoint: number) => { id: number; advanceWidth: number };
  };
  const scale = 1000 / parsed.unitsPerEm;
  // Kodierung wie bisher; ohne Angabe WinAnsi (nicht symbolische TrueType-Schriften brauchen eine, PDF/A 6.2.11.6)
  if (!font.has(N('Encoding'))) font.set(N('Encoding'), N('WinAnsiEncoding'));
  const encoding = encodingOf(doc, font, 'Helvetica');
  const widths: number[] = [];
  for (let code = 0; code <= 255; code++) {
    const unicode = GLYPH_UNICODE.get(encoding[code] ?? '');
    const glyph = unicode !== undefined ? parsed.glyphForCodePoint(unicode) : null;
    widths.push(Math.round((glyph && glyph.id !== 0 ? glyph.advanceWidth : 0) * scale));
  }
  const name = parsed.postscriptName.replace(/[^\x21-\x7e]/g, '') || 'Font';
  const italic = parsed.italicAngle !== 0;
  const descriptor = doc.context.obj({
    Type: 'FontDescriptor',
    FontName: N(name),
    Flags: 32 + (italic ? 64 : 0),
    FontBBox: [parsed.bbox.minX, parsed.bbox.minY, parsed.bbox.maxX, parsed.bbox.maxY].map((v) => Math.round(v * scale)),
    ItalicAngle: parsed.italicAngle,
    Ascent: Math.round(parsed.ascent * scale),
    Descent: Math.round(parsed.descent * scale),
    CapHeight: Math.round((parsed.capHeight || parsed.ascent) * scale),
    StemV: 80,
    FontFile2: doc.context.register(doc.context.flateStream(program, { Length1: program.length })),
  });
  font.set(N('Subtype'), N('TrueType'));
  font.set(N('BaseFont'), N(name));
  font.set(N('FirstChar'), PDFNumber.of(0));
  font.set(N('LastChar'), PDFNumber.of(255));
  font.set(N('Widths'), doc.context.obj(widths));
  font.set(N('FontDescriptor'), doc.context.register(descriptor));
}

function embedStandardFont(doc: PDFDocument, font: PDFDict, standard: StandardFontName, program: Uint8Array): void {
  const widths = cffWidths(program);
  const encoding = encodingOf(doc, font, standard);
  const notdef = widths.get('.notdef') ?? 0;
  const metrics = Font.load(standard);
  const first = 0;
  const last = 255;
  const widthArray: number[] = [];
  for (let code = first; code <= last; code++) widthArray.push(Math.round(widths.get(encoding[code] ?? '') ?? notdef));
  const symbolic = standard === 'Symbol' || standard === 'ZapfDingbats';
  const flags = (standard.startsWith('Courier') ? 1 : 0) + (standard.startsWith('Times') ? 2 : 0) + (symbolic ? 4 : 32) + (/Oblique|Italic/.test(standard) ? 64 : 0);
  const file = doc.context.flateStream(program, { Subtype: 'Type1C' });
  const descriptor = doc.context.obj({
    Type: 'FontDescriptor',
    FontName: N(standard),
    Flags: flags,
    FontBBox: metrics.FontBBox,
    ItalicAngle: metrics.ItalicAngle,
    Ascent: metrics.Ascender ?? metrics.FontBBox[3],
    Descent: metrics.Descender ?? metrics.FontBBox[1],
    CapHeight: metrics.CapHeight ?? metrics.FontBBox[3],
    StemV: metrics.StdVW ?? 80,
    FontFile3: doc.context.register(file),
  });
  font.set(N('Subtype'), N('Type1'));
  font.set(N('BaseFont'), N(standard));
  font.set(N('FirstChar'), PDFNumber.of(first));
  font.set(N('LastChar'), PDFNumber.of(last));
  font.set(N('Widths'), doc.context.obj(widthArray));
  font.set(N('FontDescriptor'), doc.context.register(descriptor));
}

interface FontProblem {
  dict: PDFDict;
  baseFont: string;
  standard: StandardFontName | null;
  // einfache Schrift (nicht Type0): lässt sich durch eine Schrift des Rechners ersetzen
  simple: boolean;
}

function fontsWithoutProgram(doc: PDFDocument): FontProblem[] {
  const problems: FontProblem[] = [];
  for (const dict of allDicts(doc)) {
    if (nameOf(dict.get(N('Type'))) !== 'Font') continue;
    const subtype = nameOf(dict.get(N('Subtype')));
    const baseFont = nameOf(dict.lookup(N('BaseFont'))) ?? '';
    if (subtype === 'Type3') continue;
    if (subtype === 'Type0') {
      const descendants = dict.lookup(N('DescendantFonts'));
      const descendant = descendants instanceof PDFArray ? doc.context.lookup(descendants.get(0)) : null;
      if (descendant instanceof PDFDict && !fontFile(doc, descendant)) problems.push({ dict, baseFont, standard: null, simple: false });
      continue;
    }
    if (!fontFile(doc, dict)) problems.push({ dict, baseFont, standard: standardFor(baseFont), simple: true });
  }
  return problems;
}

// ——— Farben ———

const CMYK_OPERATOR = /(^|[\s\]>)])(k|K)(?=[\s[<(/]|$)/m;

function usesCmyk(doc: PDFDocument): boolean {
  for (const dict of allDicts(doc)) {
    for (const [key, value] of dict.entries()) {
      const name = nameOf(value);
      if (name === 'DeviceCMYK' && key.decodeText() !== 'DefaultCMYK') return true;
    }
    for (const [, value] of dict.entries()) if (value instanceof PDFArray && value.asArray().some((item) => nameOf(item) === 'DeviceCMYK')) return true;
  }
  // Farboperatoren im Seiteninhalt und in Formular-XObjects
  for (const [, stream] of allStreams(doc)) {
    const type = nameOf(stream.dict.get(N('Subtype')));
    // Nur Seiteninhalte (ohne Subtype) und Formular-XObjects; Schriften, Profile und Metadaten nicht
    if ((type && type !== 'Form') || stream.dict.has(N('Length1')) || stream.dict.has(N('N')) || stream.dict.has(N('Type')) && !type) continue;
    try {
      const text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
      if (/\b(BT|re|Tf|cm|Do|f|S)\b/.test(text) && CMYK_OPERATOR.test(text)) return true;
    } catch {
      // nicht lesbarer Strom: nicht berücksichtigt
    }
  }
  return false;
}

function addDefaultCmyk(doc: PDFDocument, profile: Uint8Array): void {
  const icc = doc.context.register(doc.context.flateStream(profile, { N: 4 }));
  const space = doc.context.obj([N('ICCBased'), icc]);
  const resources: PDFDict[] = [];
  for (const page of doc.getPages()) {
    const own = page.node.Resources();
    if (own) resources.push(own);
  }
  for (const [, stream] of allStreams(doc)) {
    if (nameOf(stream.dict.get(N('Subtype'))) !== 'Form') continue;
    const own = stream.dict.lookup(N('Resources'));
    if (own instanceof PDFDict) resources.push(own);
  }
  for (const dict of resources) {
    let colorSpaces = dict.lookup(N('ColorSpace'));
    if (!(colorSpaces instanceof PDFDict)) {
      colorSpaces = doc.context.obj({});
      dict.set(N('ColorSpace'), colorSpaces);
    }
    (colorSpaces as PDFDict).set(N('DefaultCMYK'), space);
  }
}

// ——— Metadaten ———

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isoDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const pdfDate = (date: Date) => {
  const two = (n: number) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
};

function infoText(doc: PDFDocument, key: string): string | null {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return null;
  const value = info.lookup(N(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : null;
}

function writeMetadata(doc: PDFDocument, now: Date, producer: string): void {
  const title = infoText(doc, 'Title');
  const author = infoText(doc, 'Author');
  const subject = infoText(doc, 'Subject');
  const keywords = infoText(doc, 'Keywords');
  const creator = infoText(doc, 'Creator') ?? producer;
  const created = now;
  const lines = [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    '<pdfaid:part>2</pdfaid:part>',
    '<pdfaid:conformance>B</pdfaid:conformance>',
    ...(title ? [`<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(title)}</rdf:li></rdf:Alt></dc:title>`] : []),
    ...(author ? [`<dc:creator><rdf:Seq><rdf:li>${xml(author)}</rdf:li></rdf:Seq></dc:creator>`] : []),
    ...(subject ? [`<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(subject)}</rdf:li></rdf:Alt></dc:description>`] : []),
    ...(keywords ? [`<pdf:Keywords>${xml(keywords)}</pdf:Keywords>`] : []),
    `<xmp:CreatorTool>${xml(creator)}</xmp:CreatorTool>`,
    `<xmp:CreateDate>${isoDate(created)}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${isoDate(now)}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${isoDate(now)}</xmp:MetadataDate>`,
    `<pdf:Producer>${xml(producer)}</pdf:Producer>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ];
  // Unkomprimiert, wie PDF/A verlangt
  const stream = doc.context.stream(new TextEncoder().encode(lines.join('\n')), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(N('Metadata'), doc.context.register(stream));
  // Dokumentinformationen genau passend zu den XMP-Angaben
  const info = doc.context.obj({
    ...(title ? { Title: PDFHexString.fromText(title) } : {}),
    ...(author ? { Author: PDFHexString.fromText(author) } : {}),
    ...(subject ? { Subject: PDFHexString.fromText(subject) } : {}),
    ...(keywords ? { Keywords: PDFHexString.fromText(keywords) } : {}),
    Creator: PDFHexString.fromText(creator),
    Producer: PDFHexString.fromText(producer),
    CreationDate: PDFString.of(pdfDate(created)),
    ModDate: PDFString.of(pdfDate(now)),
  });
  doc.context.trailerInfo.Info = doc.context.register(info);
}

// ——— Anmerkungen, Aktionen, Sonstiges ———

function cleanAnnotations(doc: PDFDocument): number {
  let removed = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    const kept: PDFObject[] = [];
    for (const entry of annots.asArray()) {
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameOf(annot.get(N('Subtype'))) ?? '';
      const appearance = annot.lookup(N('AP'));
      const hasAppearance = appearance instanceof PDFDict && appearance.has(N('N'));
      const rect = annot.lookup(N('Rect'));
      const empty = rect instanceof PDFArray && rect.size() === 4 && rect.asArray().every((value, i) => i < 2 || value instanceof PDFNumber) && (() => {
        const [l, b, r, t] = rect.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : 0));
        return r === l || t === b;
      })();
      if (FORBIDDEN_ANNOTATIONS.has(subtype) || (!hasAppearance && !empty && subtype !== 'Popup' && subtype !== 'Link')) {
        removed++;
        continue;
      }
      const flags = annot.lookup(N('F'));
      const value = flags instanceof PDFNumber ? flags.asNumber() : 0;
      // Unsichtbare Signaturfelder (Rechteck ohne Fläche) bleiben versteckt
      const next = empty && subtype === 'Widget' ? value : (value | FLAG.print) & ~(FLAG.invisible | FLAG.hidden | FLAG.noView | FLAG.toggleNoView);
      annot.set(N('F'), PDFNumber.of(subtype === 'Popup' ? value & ~FLAG.invisible : next));
      kept.push(entry);
    }
    page.node.set(N('Annots'), doc.context.obj(kept));
  }
  return removed;
}

function cleanActions(doc: PDFDocument): number {
  let removed = 0;
  for (const dict of allDicts(doc)) {
    if (dict.has(N('AA'))) {
      dict.delete(N('AA'));
      removed++;
    }
    for (const key of ['A', 'OpenAction']) {
      const action = dict.lookup(N(key));
      if (action instanceof PDFDict && FORBIDDEN_ACTIONS.has(nameOf(action.get(N('S'))) ?? '')) {
        dict.delete(N(key));
        removed++;
      }
    }
  }
  const names = doc.catalog.lookup(N('Names'));
  if (names instanceof PDFDict) {
    for (const key of ['JavaScript', 'EmbeddedFiles']) {
      if (names.has(N(key))) {
        names.delete(N(key));
        removed++;
      }
    }
  }
  if (doc.catalog.has(N('AF'))) doc.catalog.delete(N('AF'));
  const acroForm = doc.catalog.lookup(N('AcroForm'));
  if (acroForm instanceof PDFDict) {
    acroForm.delete(N('XFA'));
    acroForm.delete(N('NeedAppearances'));
  }
  return removed;
}

function cleanGraphics(doc: PDFDocument): void {
  for (const dict of allDicts(doc)) {
    if (dict.lookup(N('Interpolate')) instanceof PDFBool) dict.set(N('Interpolate'), PDFBool.False);
    if (nameOf(dict.get(N('Type'))) === 'ExtGState' || dict.has(N('TR')) || dict.has(N('TR2'))) {
      dict.delete(N('TR'));
      if (nameOf(dict.get(N('TR2'))) !== 'Default') dict.delete(N('TR2'));
      dict.delete(N('HTP'));
    }
  }
  // LZW ist in PDF/A verboten: entpacken und mit Flate packen
  for (const [ref, stream] of allStreams(doc)) {
    if (!filters(stream.dict, doc).includes('LZWDecode')) continue;
    const packed = doc.context.flateStream(decodePDFRawStream(stream).decode());
    for (const [key, value] of stream.dict.entries()) if (!['Filter', 'DecodeParms', 'Length'].includes(key.decodeText())) packed.dict.set(key, value);
    doc.context.assign(ref, packed);
  }
  // Optionale Inhalte: Konfigurationen brauchen einen Namen und kein /AS
  const ocProperties = doc.catalog.lookup(N('OCProperties'));
  if (ocProperties instanceof PDFDict) {
    const configs = [ocProperties.lookup(N('D')), ...((ocProperties.lookup(N('Configs')) as PDFArray | undefined)?.asArray().map((item) => doc.context.lookup(item)) ?? [])];
    configs.forEach((config, i) => {
      if (!(config instanceof PDFDict)) return;
      if (!config.has(N('Name'))) config.set(N('Name'), PDFHexString.fromText(i === 0 ? 'Standard' : `Ansicht ${i}`));
      config.delete(N('AS'));
    });
  }
}

// ——— Erzeugen ———

export interface PdfAResult {
  bytes: Uint8Array;
  // Was geändert wurde (für den Hinweis an den Nutzer)
  embeddedFonts: string[];
  removed: number;
}

export async function convertToPdfA(bytes: Uint8Array, resources: PdfAResources, now: Date, producer: string): Promise<PdfAResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const fonts = fontsWithoutProgram(doc);
  // Erst eine Schrift des Rechners (gleiche Familie, sieht aus wie gedacht), sonst die ähnliche Standardschrift
  const system = new Map<string, Uint8Array | null>();
  const systemProgram = (font: FontProblem) => {
    if (!font.simple || !resources.systemFont) return null;
    if (!system.has(font.baseFont)) system.set(font.baseFont, resources.systemFont(font.baseFont));
    return system.get(font.baseFont) ?? null;
  };
  const unfixable = [...new Set(fonts.filter((font) => !font.standard && !systemProgram(font)).map((font) => font.baseFont || '?'))];
  if (unfixable.length > 0) throw new PdfAError('pdfa-fonts', unfixable.join(', '));
  const embedded = new Set<string>();
  const programs = new Map<StandardFontName, Uint8Array>();
  for (const font of fonts) {
    const own = systemProgram(font);
    if (own) {
      await embedTrueTypeFont(doc, font.dict, own);
    } else {
      const standard = font.standard as StandardFontName;
      if (!programs.has(standard)) programs.set(standard, resources.standardFont(standard));
      embedStandardFont(doc, font.dict, standard, programs.get(standard) as Uint8Array);
    }
    embedded.add(font.baseFont);
  }
  if (usesCmyk(doc)) {
    if (!resources.cmykProfile) throw new PdfAError('pdfa-cmyk', 'CMYK');
    addDefaultCmyk(doc, resources.cmykProfile);
  }
  const removed = cleanAnnotations(doc) + cleanActions(doc);
  cleanGraphics(doc);
  const profile = doc.context.register(doc.context.flateStream(srgbProfile(), { N: 3 }));
  doc.catalog.set(
    N('OutputIntents'),
    doc.context.obj([
      {
        Type: 'OutputIntent',
        S: 'GTS_PDFA1',
        OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
        Info: PDFString.of('sRGB IEC61966-2.1'),
        RegistryName: PDFString.of('http://www.color.org'),
        DestOutputProfile: profile,
      },
    ]),
  );
  writeMetadata(doc, now, producer);
  // Dokument-ID (Pflicht)
  const id = PDFHexString.of(Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
  doc.context.header = PDFHeader.forVersion(1, 7);
  const output = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: output, embeddedFonts: [...embedded], removed };
}

// ——— Prüfen ———

function declared(doc: PDFDocument): PdfAReport['declared'] {
  const metadata = doc.catalog.lookup(N('Metadata'));
  if (!(metadata instanceof PDFRawStream)) return null;
  try {
    const text = new TextDecoder().decode(decodePDFRawStream(metadata).decode());
    const part = /pdfaid:part(?:>|\s*=\s*["'])(\d)/.exec(text)?.[1];
    const conformance = /pdfaid:conformance(?:>|\s*=\s*["'])([ABUabu])/.exec(text)?.[1];
    return part ? { part: Number(part), conformance: (conformance ?? '').toUpperCase() } : null;
  } catch {
    return null;
  }
}

export async function checkPdfA(bytes: Uint8Array): Promise<PdfAReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const issues: PdfAIssue[] = [];
  const pdfa = declared(doc);
  if (!pdfa) issues.push({ code: 'not-declared' });
  if (doc.isEncrypted) issues.push({ code: 'encrypted' });
  const intents = doc.catalog.lookup(N('OutputIntents'));
  const hasIntent = intents instanceof PDFArray && intents.size() > 0;
  if (!hasIntent) issues.push({ code: 'output-intent' });
  const fonts = [...new Set(fontsWithoutProgram(doc).map((font) => font.baseFont || '?'))];
  if (fonts.length > 0) issues.push({ code: 'fonts', detail: fonts.join(', ') });
  let javascript = false;
  let actions = 0;
  let annotations = 0;
  let interpolate = false;
  let transfer = false;
  for (const dict of allDicts(doc)) {
    if (dict.has(N('AA'))) actions++;
    for (const key of ['A', 'OpenAction']) {
      const action = dict.lookup(N(key));
      const kind = action instanceof PDFDict ? nameOf(action.get(N('S'))) : null;
      if (kind === 'JavaScript') javascript = true;
      else if (kind && FORBIDDEN_ACTIONS.has(kind)) actions++;
    }
    if (dict.lookup(N('Interpolate')) === PDFBool.True) interpolate = true;
    if (dict.has(N('TR')) || (dict.has(N('TR2')) && nameOf(dict.get(N('TR2'))) !== 'Default')) transfer = true;
  }
  const names = doc.catalog.lookup(N('Names'));
  if (names instanceof PDFDict && names.has(N('JavaScript'))) javascript = true;
  if (javascript) issues.push({ code: 'javascript' });
  if (actions > 0) issues.push({ code: 'actions', count: actions });
  if (names instanceof PDFDict && names.has(N('EmbeddedFiles'))) issues.push({ code: 'embedded-files' });
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(N('Annots'));
    for (const entry of annots instanceof PDFArray ? annots.asArray() : []) {
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = nameOf(annot.get(N('Subtype'))) ?? '';
      const flags = annot.lookup(N('F'));
      const value = flags instanceof PDFNumber ? flags.asNumber() : 0;
      const appearance = annot.lookup(N('AP'));
      const rect = annot.lookup(N('Rect'));
      const numbers = rect instanceof PDFArray ? rect.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : 0)) : [];
      const empty = numbers.length === 4 && (numbers[0] === numbers[2] || numbers[1] === numbers[3]);
      const missingAppearance = !(appearance instanceof PDFDict && appearance.has(N('N'))) && !empty && subtype !== 'Popup' && subtype !== 'Link';
      const notPrinted = subtype !== 'Popup' && !empty && ((value & FLAG.print) === 0 || (value & (FLAG.invisible | FLAG.hidden | FLAG.noView)) !== 0);
      if (FORBIDDEN_ANNOTATIONS.has(subtype) || missingAppearance || notPrinted) annotations++;
    }
  }
  if (annotations > 0) issues.push({ code: 'annotations', count: annotations });
  const acroForm = doc.catalog.lookup(N('AcroForm'));
  if (acroForm instanceof PDFDict && acroForm.has(N('XFA'))) issues.push({ code: 'xfa' });
  if (acroForm instanceof PDFDict && acroForm.lookup(N('NeedAppearances')) === PDFBool.True) issues.push({ code: 'need-appearances' });
  if (allStreams(doc).some(([, stream]) => filters(stream.dict, doc).includes('LZWDecode'))) issues.push({ code: 'lzw' });
  if (interpolate) issues.push({ code: 'interpolate' });
  if (transfer) issues.push({ code: 'transfer' });
  // Geräte-CMYK braucht eine CMYK-Ausgabebedingung oder DefaultCMYK (vereinfacht: irgendwo im Dokument)
  const intent = intents instanceof PDFArray ? doc.context.lookup(intents.get(0)) : null;
  const intentProfile = intent instanceof PDFDict ? intent.lookup(N('DestOutputProfile')) : null;
  const cmykIntent = intentProfile instanceof PDFRawStream && intentProfile.dict.lookup(N('N')) instanceof PDFNumber && (intentProfile.dict.lookup(N('N')) as PDFNumber).asNumber() === 4;
  const defaultCmyk = [...allDicts(doc)].some((dict) => dict.has(N('DefaultCMYK')));
  if (!cmykIntent && !defaultCmyk && usesCmyk(doc)) issues.push({ code: 'cmyk' });
  if (!doc.context.trailerInfo.ID) issues.push({ code: 'id' });
  return { declared: pdfa, issues };
}
