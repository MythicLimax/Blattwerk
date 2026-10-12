// Umrechnung zwischen PDF-Benutzerraum (Punkte, Ursprung unten links, ungedrehte Seite) und Ansicht.
// Die Ansicht rechnet im Maßstab 1 inklusive Drehung der Seite; die Kommentarebene skaliert per SVG-viewBox.
import type { Point, Rect } from '../../shared/annotations';

export interface PageGeometry {
  width: number;
  height: number;
  toView: (p: Point) => [number, number];
  toPdf: (x: number, y: number) => Point;
  rectToView: (r: Rect) => { x: number; y: number; w: number; h: number };
}

// Ausschnitt von pdf.js' PageViewport, den die Umrechnung braucht
export interface ViewportLike {
  width: number;
  height: number;
  convertToViewportPoint: (x: number, y: number) => number[];
  convertToPdfPoint: (x: number, y: number) => number[];
}

export function geometryFromViewport(vp: ViewportLike): PageGeometry {
  const toView = (p: Point): [number, number] => {
    const [x = 0, y = 0] = vp.convertToViewportPoint(p.x, p.y);
    return [x, y];
  };
  return {
    width: vp.width,
    height: vp.height,
    toView,
    toPdf: (x, y) => {
      const [px = 0, py = 0] = vp.convertToPdfPoint(x, y);
      return { x: px, y: py };
    },
    rectToView: ([l, b, r, t]) => {
      const [x1, y1] = toView({ x: l, y: b });
      const [x2, y2] = toView({ x: r, y: t });
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    },
  };
}
