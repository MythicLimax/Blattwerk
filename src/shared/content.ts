// Seiteninhalt bearbeiten (Phase 5, „Inhalt bearbeiten“): Text und Bilder einfügen, verschieben, skalieren, löschen,
// vorhandene Textzeilen ändern. Gemeinsam für Oberfläche und Worker. Koordinaten im PDF-Benutzerraum.
import type { Point, Rect, Rgb } from './annotations';
import type { ImageSource } from './pages';
import type { StampFont } from './stamping';

export type PageObjectKind = 'text' | 'image' | 'form';

// Ein Seitenobjekt, wie PDFium es kennt. index ist die Position in der Objektliste der Seite (gilt nur für genau
// diesen Dokumentstand).
export interface PageObjectInfo {
  index: number;
  kind: PageObjectKind;
  bounds: Rect;
  // nur Text
  text?: string;
  // Schriftgröße im Textzustand (Tf). Viele PDFs setzen 1 und skalieren über die Textmatrix.
  fontSize?: number;
  // Größe, in der der Text auf der Seite erscheint (Punkte, Tf mal senkrechte Skalierung)
  visualSize?: number;
  // Schlüssel in PageObjects.fonts
  font?: string;
  color?: Rgb;
}

export interface PageFontInfo {
  name: string;
  embedded: boolean;
  // Zeichen, die die Schrift sicher darstellen kann (bei eingebetteten Teilschriften: alle, die auf der Seite in
  // dieser Schrift vorkommen; sonst null = westeuropäischer Zeichensatz)
  chars: string | null;
}

export interface PageObjects {
  pageIndex: number;
  objects: PageObjectInfo[];
  fonts: Record<string, PageFontInfo>;
  // Mehr Objekte als angezeigt (z. B. sehr viele Textstücke); die übrigen sind nicht auswählbar
  truncated: boolean;
}

export type Matrix = [number, number, number, number, number, number];

export type ContentOperation =
  // Neuer Text, erste Grundlinie bei origin; jede Zeile ein eigenes Textobjekt. Aufrecht zur Anzeige der Seite.
  | { type: 'addText'; pageIndex: number; origin: Point; lines: string[]; font: StampFont; size: number; color: Rgb }
  | { type: 'addImage'; pageIndex: number; rect: Rect; image: ImageSource }
  // Zusätzliche Abbildung (Verschieben, Skalieren) auf ein vorhandenes Objekt
  | { type: 'transform'; pageIndex: number; index: number; matrix: Matrix }
  | { type: 'delete'; pageIndex: number; indices: number[] }
  // Text einer vorhandenen Zeile ersetzen. merge: weitere Textstücke derselben Zeile, die dabei entfallen (der neue
  // Text steht dann ganz im Objekt index)
  | { type: 'editText'; pageIndex: number; index: number; text: string; merge?: number[] };

// Höchstens so viele Objekte je Seite werden zum Bearbeiten angeboten
export const MAX_PAGE_OBJECTS = 3000;

export const LINE_HEIGHT = 1.2;

// Zeichen des westeuropäischen Zeichensatzes (WinAnsi), die Standardschriften ohne Einbetten darstellen
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

export function isWinAnsi(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(char);
}

// Zeichen, die die Schrift einer Zeile nicht darstellen kann (dann verwendet die App eine Standardschrift)
export function missingChars(text: string, font: PageFontInfo | undefined): string {
  const chars = [...new Set([...text])].filter((char) => char !== ' ' && char !== '\n');
  if (!font) return chars.filter((char) => !isWinAnsi(char)).join('');
  if (font.chars === null) return chars.filter((char) => !isWinAnsi(char)).join('');
  const known = new Set([...font.chars]);
  return chars.filter((char) => !known.has(char)).join('');
}

// Bild (Einheitsquadrat) aufrecht in das angezeigte Rechteck legen; rotation = EXIF-Drehung im Uhrzeigersinn
export function imageMatrix([left, bottom, right, top]: Rect, rotation: 0 | 90 | 180 | 270): Matrix {
  const width = right - left;
  const height = top - bottom;
  switch (rotation) {
    case 90:
      return [0, -height, width, 0, left, top];
    case 180:
      return [-width, 0, 0, -height, right, top];
    case 270:
      return [0, height, -width, 0, right, bottom];
    default:
      return [width, 0, 0, height, left, bottom];
  }
}

// Verschieben um (dx, dy)
export const translation = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];

// Gleichmäßig skalieren um den festen Punkt (fx, fy)
export const scalingAbout = (factor: number, fx: number, fy: number): Matrix => [factor, 0, 0, factor, fx - factor * fx, fy - factor * fy];

// Ein PDF speichert Text in Stücken (oft Wörter oder Wortteile). Für das Bearbeiten werden Stücke zu einer Zeile
// zusammengefasst, die auf derselben Höhe liegen, gleich aussehen (Schrift, Größe, Farbe) und nur durch kleine
// Lücken getrennt sind. Große Lücken (Spalten, Tabellen) und andere Schriften (z. B. ein fettes Wort) trennen.
const sameRgb = (a: Rgb | undefined, b: Rgb | undefined) =>
  (a === undefined && b === undefined) || (a !== undefined && b !== undefined && Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.02);

const sizeOf = (object: PageObjectInfo) => object.visualSize ?? object.fontSize ?? 0;

function sameLine(a: PageObjectInfo, b: PageObjectInfo): boolean {
  if (a.kind !== 'text' || b.kind !== 'text' || a.font !== b.font || !sameRgb(a.color, b.color)) return false;
  const size = sizeOf(a);
  if (size <= 0 || Math.abs(size - sizeOf(b)) > size * 0.05) return false;
  // Höhe: Grundlinien nahe beieinander (die Unterkante schwankt mit Unterlängen, deshalb Mitte und Überlappung)
  const [, ab, , at] = a.bounds;
  const [, bb, , bt] = b.bounds;
  const overlap = Math.min(at, bt) - Math.max(ab, bb);
  return overlap > 0.5 * Math.min(at - ab, bt - bb) && Math.abs(ab - bb) < size * 0.35;
}

// Alle Stücke der Zeile, zu der das Objekt index gehört, von links nach rechts
export function lineOf(objects: PageObjectInfo[], index: number): PageObjectInfo[] {
  const start = objects.find((object) => object.index === index);
  if (!start || start.kind !== 'text') return start ? [start] : [];
  const candidates = objects.filter((object) => object === start || sameLine(start, object)).sort((a, b) => a.bounds[0] - b.bounds[0]);
  const at = candidates.indexOf(start);
  const size = sizeOf(start);
  const fits = (left: PageObjectInfo, right: PageObjectInfo) => {
    const gap = right.bounds[0] - left.bounds[2];
    return gap < size * 1.2 && gap > -size * 0.5;
  };
  let first = at;
  while (first > 0 && fits(candidates[first - 1] as PageObjectInfo, candidates[first] as PageObjectInfo)) first--;
  let last = at;
  while (last < candidates.length - 1 && fits(candidates[last] as PageObjectInfo, candidates[last + 1] as PageObjectInfo)) last++;
  return candidates.slice(first, last + 1);
}

// Text der Zeile; zwischen Stücken mit sichtbarer Lücke steht ein Leerzeichen (PDFium hängt es oft schon selbst an)
export function lineText(pieces: PageObjectInfo[]): string {
  let text = '';
  pieces.forEach((piece, i) => {
    const previous = pieces[i - 1];
    const own = piece.text ?? '';
    if (previous && !/\s$/.test(text) && !/^\s/.test(own) && piece.bounds[0] - previous.bounds[2] > sizeOf(piece) * 0.12) text += ' ';
    text += own;
  });
  return text.trimEnd();
}

// Seitenobjekte für die Bearbeitung: Textstücke einer Zeile als eine Einheit (Anker = erstes Stück, members = alle
// Stücke einschließlich Anker), Bilder und Grafikgruppen einzeln
export type EditUnit = PageObjectInfo & { members: number[] };

export function editUnits(objects: PageObjectInfo[]): EditUnit[] {
  const assigned = new Set<number>();
  const units: EditUnit[] = [];
  for (const object of objects) {
    if (assigned.has(object.index)) continue;
    if (object.kind !== 'text') {
      units.push({ ...object, members: [object.index] });
      continue;
    }
    const pieces = lineOf(objects, object.index).filter((piece) => !assigned.has(piece.index));
    for (const piece of pieces) assigned.add(piece.index);
    const [anchor = object] = pieces;
    units.push({ ...anchor, bounds: unionBounds(pieces), text: lineText(pieces), members: pieces.map((piece) => piece.index) });
  }
  return units;
}

export function unionBounds(pieces: PageObjectInfo[]): Rect {
  return pieces.reduce<Rect>(
    (acc, { bounds }) => [Math.min(acc[0], bounds[0]), Math.min(acc[1], bounds[1]), Math.max(acc[2], bounds[2]), Math.max(acc[3], bounds[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}
