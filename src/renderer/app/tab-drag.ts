// Rechnungen für das Ziehen von Tabs (ADR 0026), ohne DOM, damit sie sich ohne Oberfläche testen lassen.
// Alle Lagen sind waagerechte Positionen der Tabs vor dem Ziehen (ohne Verschiebungen durch die Animation).

export interface Slot {
  id: string;
  left: number;
  width: number;
}

// Abstand zwischen zwei Tabs (aus den Lagen; mit nur einem Tab die Vorgabe der Leiste)
export function slotGap(slots: readonly Slot[], fallback = 4): number {
  const [first, second] = slots;
  return first && second ? Math.max(0, second.left - (first.left + first.width)) : fallback;
}

// Stelle in der Liste nach dem Verschieben: hinter allen anderen Tabs, deren Mitte links von der Mitte des gezogenen liegt
export function targetIndex(slots: readonly Slot[], draggedId: string, draggedCenter: number): number {
  return slots.filter((slot) => slot.id !== draggedId && slot.left + slot.width / 2 < draggedCenter).length;
}

// Verschiebung des gezogenen Tabs, begrenzt auf die Strecke zwischen erstem und letztem Tab
export function clampDrag(slots: readonly Slot[], draggedId: string, dx: number): number {
  const dragged = slots.find((slot) => slot.id === draggedId);
  const first = slots[0];
  const last = slots[slots.length - 1];
  if (!dragged || !first || !last) return dx;
  const min = first.left - dragged.left;
  const max = last.left + last.width - (dragged.left + dragged.width);
  return Math.min(Math.max(dx, min), max);
}

// Wie weit ein anderer Tab ausweicht, damit an der Zielstelle Platz für den gezogenen ist. detached: Der gezogene Tab ist
// aus der Leiste heraus; die Tabs dahinter schließen die Lücke.
export function shiftFor(index: number, origin: number, target: number | null, step: number): number {
  if (index === origin) return 0;
  if (target === null) return index > origin ? -step : 0;
  if (index > origin && index <= target) return -step;
  if (index < origin && index >= target) return step;
  return 0;
}

// Ein Tab aus einem anderen Fenster schwebt über der Leiste: Die Tabs ab der Einfügestelle machen Platz.
export function hoverIndex(slots: readonly Slot[], x: number): number {
  return slots.filter((slot) => slot.left + slot.width / 2 < x).length;
}
