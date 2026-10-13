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
  fontSize?: number;
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
  // Text einer vorhandenen Zeile ersetzen
  | { type: 'editText'; pageIndex: number; index: number; text: string };

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
