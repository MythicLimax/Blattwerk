// Schwärzen (Phase 5): Bereiche, deren Inhalt endgültig entfernt wird. Gemeinsam für Oberfläche und Worker.
// Koordinaten im PDF-Benutzerraum (Punkte, Ursprung unten links, ungedrehte Seite).
import { boundsOf, normalizeRect, type Quad, type Rect } from './annotations';

// Markierte Bereiche einer Seite: Rechtecke (aufgezogen) und Vierecke (markierter Text)
export interface RedactionArea {
  pageIndex: number;
  rects: Rect[];
  quads: Quad[];
}

export interface RedactionOptions {
  // Titel, Autor, Thema, Stichwörter und XMP-Metadaten entfernen
  removeMetadata: boolean;
}

// Alle Rechtecke eines Bereichs (Vierecke als umschließendes Rechteck)
export function areaRects(area: RedactionArea): Rect[] {
  return [...area.rects.map(normalizeRect), ...area.quads.map((quad) => boundsOf(quad))];
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  const [al, ab, ar, at] = normalizeRect(a);
  const [bl, bb, br, bt] = normalizeRect(b);
  return al < br && bl < ar && ab < bt && bb < at;
}

// Liegt inner vollständig in outer? (mit kleiner Toleranz für Rundungen)
export function rectContains(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  const [ol, ob, or, ot] = normalizeRect(outer);
  const [il, ib, ir, it] = normalizeRect(inner);
  return il >= ol - tolerance && ib >= ob - tolerance && ir <= or + tolerance && it <= ot + tolerance;
}

// Fasst die Bereiche je Seite zusammen (eine Seite kann mehrere Markierungen haben).
export function mergeAreas(areas: RedactionArea[]): RedactionArea[] {
  const byPage = new Map<number, RedactionArea>();
  for (const area of areas) {
    const current = byPage.get(area.pageIndex) ?? { pageIndex: area.pageIndex, rects: [], quads: [] };
    current.rects.push(...area.rects);
    current.quads.push(...area.quads);
    byPage.set(area.pageIndex, current);
  }
  return [...byPage.values()].sort((a, b) => a.pageIndex - b.pageIndex);
}

// Text suchen, um alle Treffer zu schwärzen
export interface TextSearchOptions {
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
}

// Ein Treffer: Vierecke je Zeile (ein Treffer kann über einen Zeilenumbruch gehen)
export interface TextMatch {
  pageIndex: number;
  quads: Quad[];
}
