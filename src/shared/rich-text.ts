// Text mit gemischter Gestaltung (wie in einer Textverarbeitung): eine Folge von Stücken, jedes mit eigener Größe,
// Schrift und Farbe. Gemeinsam für die Eingabe auf der Seite und den Worker, der die Stücke setzt. Positionen sind
// Zeichenpositionen im gesamten Text (UTF-16, wie in einer Texteingabe); \n ist ein harter Zeilenumbruch.
import type { Rgb } from './annotations';
import type { TextFont } from './fonts';

export interface RunStyle {
  // Größe in Punkt, wie sie auf der Seite erscheint
  size: number;
  color: Rgb;
  // Neue Schrift (Standardschrift oder Schrift des Rechners); ohne Angabe die Schrift des Objekts source
  font?: TextFont;
  // Vorhandenes Textobjekt (Index in der Objektliste der Seite), dessen Schrift weiter gilt
  source?: number;
  // Schlüssel der Schrift in der Objektliste (nur zum Vergleichen und für die Vorschau)
  key?: string;
}

export interface TextRun extends RunStyle {
  text: string;
  // Daten einer Schrift des Rechners (hängt die Oberfläche vor dem Senden an, siehe system-fonts.ts)
  fontData?: ArrayBuffer;
}

// Änderung der Gestaltung aus der Leiste
export interface StylePatch {
  size?: number;
  color?: Rgb;
  font?: TextFont;
}

const sameColor = (a: Rgb, b: Rgb) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.004;

// Gleiche Schrift: dieselbe neue Schrift oder dieselbe vorhandene (gleicher Schlüssel bzw. dasselbe Objekt)
export function sameFont(a: RunStyle, b: RunStyle): boolean {
  if (a.font !== undefined || b.font !== undefined) return a.font === b.font;
  if (a.key !== undefined && b.key !== undefined) return a.key === b.key;
  return a.source === b.source;
}

export function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return Math.abs(a.size - b.size) < 0.05 && sameColor(a.color, b.color) && sameFont(a, b);
}

export function styleOf(run: RunStyle): RunStyle {
  return {
    size: run.size,
    color: run.color,
    ...(run.font !== undefined ? { font: run.font } : {}),
    ...(run.source !== undefined ? { source: run.source } : {}),
    ...(run.key !== undefined ? { key: run.key } : {}),
  };
}

export function withStyle(style: RunStyle, patch: StylePatch): RunStyle {
  // Neue Schrift: die vorhandene (source, key) gilt nicht mehr
  if (patch.font !== undefined) return { size: patch.size ?? style.size, color: patch.color ?? style.color, font: patch.font };
  return { ...style, ...(patch.size !== undefined ? { size: patch.size } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) };
}

// Leere Stücke weglassen, benachbarte gleicher Gestaltung zusammenfassen
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, run)) out[out.length - 1] = { ...last, text: last.text + run.text };
    else out.push({ ...styleOf(run), text: run.text });
  }
  return out;
}

export const runsText = (runs: TextRun[]) => runs.map((run) => run.text).join('');

export function isMixed(runs: TextRun[]): boolean {
  const [first] = runs;
  return first !== undefined && runs.some((run) => !sameStyle(first, run));
}

// Gestaltung an einer Stelle: die des Zeichens davor (am Anfang die des ersten Zeichens), wie beim Weiterschreiben
export function styleAt(runs: TextRun[], offset: number): RunStyle | null {
  let position = 0;
  for (const run of runs) {
    const end = position + run.text.length;
    if (offset <= end && offset > position) return styleOf(run);
    position = end;
  }
  const [first] = runs;
  return first ? styleOf(first) : null;
}

// Stücke an der Stelle offset trennen; liefert den Index des ersten Stücks ab offset
function splitAt(runs: TextRun[], offset: number): number {
  let position = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i] as TextRun;
    const end = position + run.text.length;
    if (offset === position) return i;
    if (offset < end) {
      runs.splice(i, 1, { ...run, text: run.text.slice(0, offset - position) }, { ...run, text: run.text.slice(offset - position) });
      return i + 1;
    }
    position = end;
  }
  return runs.length;
}

export function replaceRange(runs: TextRun[], start: number, end: number, text: string, style: RunStyle): TextRun[] {
  const copy = runs.map((run) => ({ ...run }));
  const from = splitAt(copy, start);
  const to = splitAt(copy, end);
  copy.splice(from, to - from, { ...styleOf(style), text });
  return normalizeRuns(copy);
}

export function restyleRange(runs: TextRun[], start: number, end: number, patch: StylePatch): TextRun[] {
  const copy = runs.map((run) => ({ ...run }));
  const from = splitAt(copy, start);
  const to = splitAt(copy, end);
  for (let i = from; i < to; i++) {
    const run = copy[i] as TextRun;
    copy[i] = { ...withStyle(run, patch), text: run.text };
  }
  return normalizeRuns(copy);
}
