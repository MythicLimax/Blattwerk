// Was beim Anwenden der Schwärzungen an den Worker geht (Phase 5, ADR 0008). Ohne DOM, damit testbar.
import type { Annotation, AnnotationChanges, RedactAnnotation } from '../../../shared/annotations';
import type { RedactionArea } from '../../../shared/redaction';
import { computeChanges } from '../annotations/changes';

export interface RedactionPlan {
  // Übrige Kommentaränderungen (werden vorher übernommen)
  changes: AnnotationChanges;
  areas: RedactionArea[];
  markCount: number;
}

export function isRedaction(a: Annotation): a is RedactAnnotation {
  return a.kind === 'redact';
}

// Neue und geänderte Markierungen gehen mit ihrer Lage an den Worker. Unveränderte aus der Datei liest PDFium dort mit
// genauer Lage (pdf.js kennt nur ihr Rechteck); dafür genügt die Seite. Geänderte aus der Datei werden vorher gelöscht,
// sonst würde zusätzlich ihre alte Stelle geschwärzt.
export function planRedaction(items: Annotation[], originals: Record<string, Annotation>): RedactionPlan {
  const all = computeChanges(items, originals);
  const marks = items.filter(isRedaction);
  const deletions = [...all.deletions];
  const areas: RedactionArea[] = [];
  for (const mark of marks) {
    const original = mark.ref ? originals[mark.id] : undefined;
    const unchanged = original !== undefined && JSON.stringify(original) === JSON.stringify(mark);
    if (unchanged) {
      areas.push({ pageIndex: mark.pageIndex, rects: [], quads: [] });
      continue;
    }
    if (mark.ref) deletions.push(mark.ref);
    areas.push({ pageIndex: mark.pageIndex, rects: mark.quads.length > 0 ? [] : [mark.rect], quads: mark.quads });
  }
  return {
    changes: { upserts: all.upserts.filter((upsert) => upsert.annotation.kind !== 'redact'), deletions },
    areas,
    markCount: marks.length,
  };
}
