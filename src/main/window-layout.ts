// Lage neuer Fenster und Ziel beim Loslassen eines Tabs (ADR 0026). Reine Rechnungen ohne Electron, damit sie
// sich ohne Fenster testen lassen.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// Versatz eines neuen Fensters gegenüber dem vorderen, wie bei Vorschau und Finder
export const CASCADE_OFFSET = 28;

export const contains = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;

// Verschiebt das Fenster so, dass es ganz im Arbeitsbereich liegt (soweit es hineinpasst).
export function fitInto(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// Neues Fenster leicht versetzt zum vorderen; reicht der Platz nicht, beginnt die Treppe oben links neu.
export function cascadeFrom(front: Rect, workArea: Rect): Rect {
  const next = { ...front, x: front.x + CASCADE_OFFSET, y: front.y + CASCADE_OFFSET };
  const fits = next.x + next.width <= workArea.x + workArea.width && next.y + next.height <= workArea.y + workArea.height;
  return fitInto(fits ? next : { ...front, x: workArea.x + CASCADE_OFFSET, y: workArea.y + CASCADE_OFFSET }, workArea);
}

// Neues Fenster für einen herausgezogenen Tab: Der Zeiger liegt danach etwa über dem Tab des neuen Fensters.
export function boundsAtPoint(size: { width: number; height: number }, point: Point, workArea: Rect, grip: Point = { x: 120, y: 60 }): Rect {
  return fitInto({ x: point.x - grip.x, y: point.y - grip.y, width: size.width, height: size.height }, workArea);
}

export interface WindowCandidate<T> {
  id: T;
  bounds: Rect;
}

// Wohin ein losgelassener Tab gehört. Die Fenster stehen in der Reihenfolge von vorn nach hinten.
// - Punkt im eigenen Fenster: Das eigene Fenster liegt vorn (man zieht gerade darin), also ein neues Fenster.
// - Punkt in einem anderen Fenster: dorthin (das vorderste, falls sich Fenster überlappen).
// - sonst: neues Fenster an dieser Stelle.
export function dropTarget<T>(point: Point, source: WindowCandidate<T>, others: WindowCandidate<T>[]): { kind: 'window'; id: T } | { kind: 'new' } {
  if (contains(source.bounds, point)) return { kind: 'new' };
  const hit = others.find((candidate) => candidate.id !== source.id && contains(candidate.bounds, point));
  return hit ? { kind: 'window', id: hit.id } : { kind: 'new' };
}
