// Ermittelt aus dem aktuellen Stand und dem geladenen Stand, was beim Speichern geschrieben werden muss.
import type { Annotation, AnnotationChanges } from '../../../shared/annotations';

// Felder, die das Aussehen bestimmen. Ändert sich eines davon, wird die Darstellung neu erzeugt.
function visualKey(a: Annotation): string {
  const { contents, author, modified, created, replies, statuses, id, ref, ...visual } = a;
  void contents;
  void author;
  void modified;
  void created;
  void replies;
  void statuses;
  void id;
  void ref;
  return JSON.stringify(visual);
}

// Freitext zeigt seinen Inhalt auf der Seite; dort zählt auch der Text zum Aussehen.
export function needsAppearance(original: Annotation, current: Annotation): boolean {
  if (visualKey(original) !== visualKey(current)) return true;
  return current.kind === 'freetext' && original.contents !== current.contents;
}

function isModified(original: Annotation, current: Annotation): boolean {
  return JSON.stringify(original) !== JSON.stringify(current);
}

export function computeChanges(
  items: Annotation[],
  originals: Record<string, Annotation>,
): AnnotationChanges {
  const changes: AnnotationChanges = { upserts: [], deletions: [] };
  const present = new Set(items.map((a) => a.id));

  for (const annotation of items) {
    const original = annotation.ref ? originals[annotation.id] : undefined;
    if (!original) {
      changes.upserts.push({ annotation, appearance: true });
      continue;
    }
    if (isModified(original, annotation)) {
      changes.upserts.push({ annotation, appearance: needsAppearance(original, annotation) });
    }
    // Gelöschte vorhandene Antworten
    const kept = new Set(annotation.replies.map((r) => r.ref).filter(Boolean));
    for (const reply of original.replies) if (reply.ref && !kept.has(reply.ref)) changes.deletions.push(reply.ref);
  }

  // Gelöschte vorhandene Kommentare samt Antworten und Statuseinträgen
  for (const original of Object.values(originals)) {
    if (present.has(original.id) || !original.ref) continue;
    changes.deletions.push(original.ref);
    for (const reply of original.replies) if (reply.ref) changes.deletions.push(reply.ref);
    for (const status of original.statuses) if (status.ref) changes.deletions.push(status.ref);
  }
  return changes;
}

export function hasChanges(changes: AnnotationChanges): boolean {
  return changes.upserts.length > 0 || changes.deletions.length > 0;
}

// Vorhandene Anmerkungen, die pdf.js nicht mehr selbst zeichnen darf (gelöscht oder im Aussehen geändert).
export function hiddenOriginals(items: Annotation[], originals: Record<string, Annotation>): Map<string, number> {
  const hidden = new Map<string, number>();
  const current = new Map(items.map((a) => [a.id, a]));
  for (const original of Object.values(originals)) {
    if (!original.ref) continue;
    const now = current.get(original.id);
    if (!now || needsAppearance(original, now)) hidden.set(original.ref, original.pageIndex);
  }
  return hidden;
}
