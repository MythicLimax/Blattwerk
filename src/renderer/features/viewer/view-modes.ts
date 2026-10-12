import type { ViewMode } from '../../../shared/ipc';

// Werte wie pdf.js ScrollMode und SpreadMode. Hier als Konstanten, damit die Logik ohne DOM testbar bleibt.
export const SCROLL_MODE = { VERTICAL: 0, PAGE: 3 } as const;
export const SPREAD_MODE = { NONE: 0, ODD: 1 } as const;

export interface ViewerLayout {
  scrollMode: number;
  spreadMode: number;
}

// Acrobat-Ansichten auf pdf.js abgebildet. "Zwei Seiten" zeigt 1|2, 3|4 (ohne separates Deckblatt).
export function layoutForMode(mode: ViewMode): ViewerLayout {
  switch (mode) {
    case 'single':
      return { scrollMode: SCROLL_MODE.PAGE, spreadMode: SPREAD_MODE.NONE };
    case 'continuous':
      return { scrollMode: SCROLL_MODE.VERTICAL, spreadMode: SPREAD_MODE.NONE };
    case 'two-page':
      return { scrollMode: SCROLL_MODE.PAGE, spreadMode: SPREAD_MODE.ODD };
    case 'two-page-continuous':
      return { scrollMode: SCROLL_MODE.VERTICAL, spreadMode: SPREAD_MODE.ODD };
  }
}

export function isPagedMode(mode: ViewMode): boolean {
  return mode === 'single' || mode === 'two-page';
}

export const VIEW_MODES: readonly ViewMode[] = ['single', 'continuous', 'two-page', 'two-page-continuous'];

// Umblättern per Mausrad oder Trackpad in den Seitenansichten („Einzelne Seite“, „Zwei Seiten“).
// Erst wenn man am Seitenrand weiter scrollt, sammeln sich die Bewegungen; ab einer Schwelle wird
// umgeblättert. Danach ist kurz Ruhe, damit der Nachlauf des Trackpads nicht mehrere Seiten überspringt.
export class PageFlipAccumulator {
  #sum = 0;
  #lockedUntil = 0;
  readonly #threshold: number;
  readonly #lockMs: number;

  constructor(threshold = 80, lockMs = 450) {
    this.#threshold = threshold;
    this.#lockMs = lockMs;
  }

  // Liefert 1 (vor), -1 (zurück) oder 0 (noch nicht umblättern).
  add(deltaY: number, now: number): -1 | 0 | 1 {
    if (now < this.#lockedUntil) {
      this.#lockedUntil = now + this.#lockMs;
      return 0;
    }
    if (this.#sum !== 0 && Math.sign(deltaY) !== Math.sign(this.#sum)) this.#sum = 0;
    this.#sum += deltaY;
    if (Math.abs(this.#sum) < this.#threshold) return 0;
    const direction = this.#sum > 0 ? 1 : -1;
    this.#sum = 0;
    this.#lockedUntil = now + this.#lockMs;
    return direction;
  }

  reset(): void {
    this.#sum = 0;
  }
}

// Wheel-Deltas in Pixel umrechnen (Mausräder liefern teils Zeilen statt Pixel).
export function wheelDeltaPixels(event: { deltaY: number; deltaMode: number }): number {
  const LINE_MODE = 1;
  const PAGE_MODE = 2;
  if (event.deltaMode === LINE_MODE) return event.deltaY * 40;
  if (event.deltaMode === PAGE_MODE) return event.deltaY * 800;
  return event.deltaY;
}
