// Schwärzen (Phase 5): Planung der Bereiche und Rechteck-Hilfen.
import { describe, expect, it } from 'vitest';
import type { Annotation, Quad, RedactAnnotation } from '../../src/shared/annotations';
import { areaRects, mergeAreas, rectContains, rectsIntersect } from '../../src/shared/redaction';
import { planRedaction } from '../../src/renderer/features/redaction/plan';

const base = { opacity: 1, contents: '', author: 'A', created: '', modified: '', replies: [], statuses: [], color: { r: 1, g: 0, b: 0 } };
const quad: Quad = [
  { x: 10, y: 30 },
  { x: 50, y: 30 },
  { x: 10, y: 20 },
  { x: 50, y: 20 },
];
const mark = (patch: Partial<RedactAnnotation>): RedactAnnotation => ({ ...base, id: 'n', ref: null, pageIndex: 0, kind: 'redact', rect: [0, 0, 10, 10], quads: [], ...patch });
const note: Annotation = { ...base, id: 'note', ref: null, pageIndex: 1, kind: 'note', icon: 'Comment', rect: [0, 0, 20, 20] };

describe('planRedaction', () => {
  it('neue Markierungen gehen mit Lage an den Worker, nicht als Kommentar', () => {
    const plan = planRedaction([mark({ id: 'a' }), mark({ id: 'b', pageIndex: 2, quads: [quad], rect: [10, 20, 50, 30] }), note], {});
    expect(plan.areas).toEqual([
      { pageIndex: 0, rects: [[0, 0, 10, 10]], quads: [] },
      { pageIndex: 2, rects: [], quads: [quad] },
    ]);
    expect(plan.changes.upserts.map((u) => u.annotation.id)).toEqual(['note']);
    expect(plan.changes.deletions).toEqual([]);
    expect(plan.markCount).toBe(2);
  });

  it('unveränderte Markierungen aus der Datei: nur die Seite (PDFium liest die genaue Lage)', () => {
    const fromFile = mark({ id: '7R', ref: '7R', pageIndex: 3 });
    const plan = planRedaction([fromFile], { '7R': fromFile });
    expect(plan.areas).toEqual([{ pageIndex: 3, rects: [], quads: [] }]);
    expect(plan.changes.deletions).toEqual([]);
  });

  it('verschobene Markierung aus der Datei: alte löschen, neue Lage schwärzen', () => {
    const original = mark({ id: '7R', ref: '7R' });
    const moved = { ...original, rect: [100, 100, 110, 110] as RedactAnnotation['rect'] };
    const plan = planRedaction([moved], { '7R': original });
    expect(plan.changes.deletions).toEqual(['7R']);
    expect(plan.areas).toEqual([{ pageIndex: 0, rects: [[100, 100, 110, 110]], quads: [] }]);
  });

  it('gelöschte Markierung aus der Datei wird gelöscht, nicht angewendet', () => {
    const original = mark({ id: '7R', ref: '7R' });
    const plan = planRedaction([], { '7R': original });
    expect(plan.areas).toEqual([]);
    expect(plan.changes.deletions).toEqual(['7R']);
  });
});

describe('Rechteck-Hilfen', () => {
  it('Schnitt und Enthaltensein', () => {
    expect(rectsIntersect([0, 0, 10, 10], [5, 5, 20, 20])).toBe(true);
    expect(rectsIntersect([0, 0, 10, 10], [10, 0, 20, 10])).toBe(false);
    expect(rectContains([0, 0, 10, 10], [1, 1, 9, 9])).toBe(true);
    expect(rectContains([0, 0, 10, 10], [1, 1, 11, 9])).toBe(false);
  });

  it('fasst Bereiche je Seite zusammen und liefert alle Rechtecke', () => {
    const merged = mergeAreas([
      { pageIndex: 1, rects: [[0, 0, 1, 1]], quads: [] },
      { pageIndex: 0, rects: [], quads: [quad] },
      { pageIndex: 1, rects: [], quads: [] },
    ]);
    expect(merged.map((a) => a.pageIndex)).toEqual([0, 1]);
    expect(areaRects(merged[0] as never)).toEqual([[10, 20, 50, 30]]);
  });
});
