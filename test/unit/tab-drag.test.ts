import { describe, expect, it } from 'vitest';
import { clampDrag, hoverIndex, shiftFor, slotGap, targetIndex } from '../../src/renderer/app/tab-drag';

// Drei Tabs à 100 px mit 4 px Abstand
const slots = [
  { id: 'a', left: 10, width: 100 },
  { id: 'b', left: 114, width: 100 },
  { id: 'c', left: 218, width: 100 },
];

describe('Tabs ziehen', () => {
  it('misst den Abstand zwischen Tabs', () => {
    expect(slotGap(slots)).toBe(4);
    expect(slotGap(slots.slice(0, 1))).toBe(4);
  });

  it('findet die Zielstelle über die Mitten der anderen Tabs', () => {
    expect(targetIndex(slots, 'a', 60)).toBe(0);
    expect(targetIndex(slots, 'a', 170)).toBe(1);
    expect(targetIndex(slots, 'a', 400)).toBe(2);
    expect(targetIndex(slots, 'c', 20)).toBe(0);
  });

  it('begrenzt den gezogenen Tab auf die Leiste', () => {
    expect(clampDrag(slots, 'a', -50)).toBe(0);
    expect(clampDrag(slots, 'a', 500)).toBe(208);
    expect(clampDrag(slots, 'b', 30)).toBe(30);
  });

  it('lässt die übersprungenen Tabs ausweichen', () => {
    // a ans Ende: b und c rücken nach links
    expect([0, 1, 2].map((i) => shiftFor(i, 0, 2, 104))).toEqual([0, -104, -104]);
    // c an den Anfang: a und b rücken nach rechts
    expect([0, 1, 2].map((i) => shiftFor(i, 2, 0, 104))).toEqual([104, 104, 0]);
    // b aus der Leiste heraus: c schließt die Lücke
    expect([0, 1, 2].map((i) => shiftFor(i, 1, null, 104))).toEqual([0, 0, -104]);
  });

  it('macht für einen Tab aus einem anderen Fenster an der richtigen Stelle Platz', () => {
    expect(hoverIndex(slots, 15)).toBe(0);
    expect(hoverIndex(slots, 120)).toBe(1);
    expect(hoverIndex(slots, 1000)).toBe(3);
  });
});
