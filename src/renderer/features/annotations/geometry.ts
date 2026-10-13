// Geometrie für Kommentare im PDF-Benutzerraum (Punkte, Ursprung unten links). Ohne DOM, damit testbar.
import type { Annotation, Point, Quad, Rect } from '../../../shared/annotations';
import { boundsOf, normalizeRect } from '../../../shared/annotations';

// Kommentarsorten, die man verschieben bzw. in der Größe ändern kann.
export function isMovable(a: Annotation): boolean {
  return !['highlight', 'underline', 'strikeout', 'squiggly'].includes(a.kind);
}

export function isResizable(a: Annotation): boolean {
  // Schwärzungen über markiertem Text folgen den Zeilen; nur aufgezogene Bereiche lassen sich ziehen.
  if (a.kind === 'redact') return a.quads.length === 0;
  return ['square', 'circle', 'freetext', 'stamp', 'signature'].includes(a.kind);
}

const movePoint = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });
const moveRect = ([l, b, r, t]: Rect, dx: number, dy: number): Rect => [l + dx, b + dy, r + dx, t + dy];

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  const rect = moveRect(a.rect, dx, dy);
  switch (a.kind) {
    case 'ink':
      return { ...a, rect, paths: a.paths.map((path) => path.map((p) => movePoint(p, dx, dy))) };
    case 'line':
    case 'arrow':
      return { ...a, rect, start: movePoint(a.start, dx, dy), end: movePoint(a.end, dx, dy) };
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
    case 'redact':
      return { ...a, rect, quads: a.quads.map((q) => q.map((p) => movePoint(p, dx, dy)) as Quad) };
    default:
      return { ...a, rect };
  }
}

export function withRect(a: Annotation, rect: Rect): Annotation {
  return { ...a, rect: normalizeRect(rect) };
}

// Größe ändern an einer Ecke (fixed bleibt stehen). Unterschriften behalten ihr Seitenverhältnis.
export function resizeFrom(a: Annotation, fixed: Point, to: Point): Annotation {
  if (a.kind !== 'signature') return withRect(a, [fixed.x, fixed.y, to.x, to.y]);
  const aspect = a.imageHeight / a.imageWidth;
  const width = Math.max(8, Math.abs(to.x - fixed.x));
  const height = width * aspect;
  const x2 = to.x >= fixed.x ? fixed.x + width : fixed.x - width;
  const y2 = to.y >= fixed.y ? fixed.y + height : fixed.y - height;
  return withRect(a, [fixed.x, fixed.y, x2, y2]);
}

// Rahmen für eine Linie: Endpunkte plus Platz für Linienstärke und Pfeilspitze.
export function lineRect(start: Point, end: Point, width: number): Rect {
  return boundsOf([start, end], Math.max(4, width * 4));
}

export function inkRect(paths: Point[][], width: number): Rect {
  return boundsOf(paths.flat(), Math.max(1, width));
}

// Rechteck aus zwei Eckpunkten, mit Mindestgröße (Klick ohne Ziehen ergibt die Standardgröße).
export function dragRect(from: Point, to: Point, minimum: { width: number; height: number }): Rect {
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < 4 && height < 4) {
    return [from.x, from.y - minimum.height, from.x + minimum.width, from.y];
  }
  return normalizeRect([from.x, from.y, to.x, to.y]);
}

// Bildschirm-Rechtecke einer Textauswahl (bereits in PDF-Punkte umgerechnet) zu Zeilen zusammenfassen.
// Rechtecke derselben Zeile (große vertikale Überlappung) werden zu einem Viereck verbunden.
export function quadsFromRects(rects: Rect[]): Quad[] {
  const lines: Rect[] = [];
  const sorted = rects
    .map(normalizeRect)
    .filter(([l, b, r, t]) => r - l > 0.5 && t - b > 0.5)
    .sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  for (const rect of sorted) {
    const line = lines.find(([, lb, , lt]) => {
      const overlap = Math.min(lt, rect[3]) - Math.max(lb, rect[1]);
      return overlap > 0.6 * Math.min(lt - lb, rect[3] - rect[1]);
    });
    if (line) {
      line[0] = Math.min(line[0], rect[0]);
      line[1] = Math.min(line[1], rect[1]);
      line[2] = Math.max(line[2], rect[2]);
      line[3] = Math.max(line[3], rect[3]);
    } else {
      lines.push([...rect] as Rect);
    }
  }
  return lines.map(([l, b, r, t]) => [
    { x: l, y: t },
    { x: r, y: t },
    { x: l, y: b },
    { x: r, y: b },
  ]);
}

export function rectOfQuads(quads: Quad[]): Rect {
  return boundsOf(quads.flat());
}
