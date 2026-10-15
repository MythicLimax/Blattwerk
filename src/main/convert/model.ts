// Vereinfachtes Dokumentmodell, in das alle Textformate (DOCX, ODT, RTF, Text, Markdown) übersetzt werden.
// Maße in Punkt (1/72 Zoll). Daraus entsteht HTML, das Chromium als PDF setzt (html.ts, pdf.ts).

export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  // #rrggbb
  color?: string;
  background?: string;
  size?: number;
  font?: string;
  vertical?: 'super' | 'sub';
  smallCaps?: boolean;
  caps?: boolean;
}

export type Inline =
  | { kind: 'text'; text: string; style: RunStyle; link?: string }
  | { kind: 'break' }
  | { kind: 'tab' }
  | { kind: 'image'; src: string; width: number | null; height: number | null; alt?: string };

export interface ParagraphStyle {
  align?: 'left' | 'center' | 'right' | 'justify';
  indentLeft?: number;
  indentRight?: number;
  // negativ: hängender Einzug
  indentFirst?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  // Vielfaches der Schriftgröße (z. B. 1.15) oder feste Höhe in Punkt
  lineHeight?: { multiple: number } | { exact: number };
  pageBreakBefore?: boolean;
  background?: string;
  // Standard-Schrift des Absatzes (für leere Absätze und Aufzählungszeichen)
  run?: RunStyle;
}

export interface Paragraph {
  kind: 'paragraph';
  // 1–6: Überschrift
  heading?: number;
  // Aufzählungszeichen oder Nummer („•“, „1.“, „a)“)
  marker?: string;
  // Vorformatiert (Leerzeichen und Zeilen bleiben erhalten), z. B. Code in Markdown
  preformatted?: boolean;
  style: ParagraphStyle;
  inlines: Inline[];
}

export interface TableCell {
  blocks: Block[];
  colSpan: number;
  rowSpan: number;
  background?: string;
  // Breite in Punkt, wenn bekannt
  width?: number;
  header?: boolean;
}

export interface Table {
  kind: 'table';
  rows: TableCell[][];
  borders: boolean;
  columnWidths?: number[];
}

export interface PageBreak {
  kind: 'pageBreak';
}

export type Block = Paragraph | Table | PageBreak;

export interface PageSetup {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface DocumentModel {
  title: string | null;
  // Sprache (z. B. de-DE), für Silbentrennung und Barrierefreiheit
  lang: string | null;
  page: PageSetup;
  // Grundschrift des Dokuments
  font: string | null;
  size: number;
  blocks: Block[];
  // Fußnoten in Reihenfolge, Verweis im Text als hochgestellte Nummer
  notes: Block[][];
}

// DIN A4 mit 2,5 cm Rand
export const DEFAULT_PAGE: PageSetup = { width: 595.3, height: 841.9, margins: { top: 70.9, right: 70.9, bottom: 56.7, left: 70.9 } };

export const paragraph = (inlines: Inline[], style: ParagraphStyle = {}, extra: Partial<Paragraph> = {}): Paragraph => ({ kind: 'paragraph', style, inlines, ...extra });
export const text = (value: string, style: RunStyle = {}, link?: string): Inline => ({ kind: 'text', text: value, style, ...(link ? { link } : {}) });

// Längen aus Office-Formaten in Punkt
export const twipsToPt = (twips: number) => twips / 20;
export const emuToPt = (emu: number) => emu / 12700;

export function lengthToPt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(-?[\d.]+)\s*(pt|cm|mm|in|px|pc|em)?$/.exec(value.trim());
  if (!match) return undefined;
  const n = Number.parseFloat(match[1] as string);
  if (!Number.isFinite(n)) return undefined;
  switch (match[2]) {
    case 'cm':
      return (n / 2.54) * 72;
    case 'mm':
      return (n / 25.4) * 72;
    case 'in':
      return n * 72;
    case 'px':
      return n * 0.75;
    case 'pc':
      return n * 12;
    default:
      return n;
  }
}

export function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.toLowerCase()}`;
  return undefined;
}

// Nummernformate (Word: numFmt, ODT: style:num-format)
export function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
    case 'a':
      return letters(n).toLowerCase();
    case 'upperLetter':
    case 'A':
      return letters(n);
    case 'lowerRoman':
    case 'i':
      return roman(n).toLowerCase();
    case 'upperRoman':
    case 'I':
      return roman(n);
    case 'decimalZero':
      return String(n).padStart(2, '0');
    case 'none':
      return '';
    default:
      return String(n);
  }
}

function letters(n: number): string {
  let result = '';
  let value = Math.max(1, n);
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function roman(n: number): string {
  const table: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let value = Math.max(1, Math.min(3999, n));
  let result = '';
  for (const [size, symbol] of table) {
    while (value >= size) {
      result += symbol;
      value -= size;
    }
  }
  return result;
}

// Aufzählungszeichen aus Symbolschriften (Word nutzt Symbol/Wingdings mit privaten Codes) in Unicode
export function bulletChar(raw: string, font?: string): string {
  const code = raw.codePointAt(0) ?? 0x2022;
  const symbolic = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code;
  if (/wingdings/i.test(font ?? '') || (code >= 0xf000 && /wingdings/i.test(font ?? 'wingdings'))) {
    if (symbolic === 0xa7) return '▪';
    if (symbolic === 0xd8) return '➢';
    if (symbolic === 0xfc) return '✓';
    if (symbolic === 0x76) return '❖';
    if (symbolic === 0x6c) return '●';
    if (symbolic === 0x6e) return '■';
    if (symbolic === 0x71) return '❑';
  }
  if (code >= 0xf000) return symbolic === 0xb7 ? '•' : symbolic === 0x2d ? '–' : '•';
  if (raw === 'o' && /courier/i.test(font ?? '')) return '◦';
  return raw || '•';
}
