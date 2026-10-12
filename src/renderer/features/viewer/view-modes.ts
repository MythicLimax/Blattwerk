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
