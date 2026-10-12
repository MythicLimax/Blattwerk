// Zoom-Logik ohne DOM, damit sie testbar bleibt.

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 25;

export const PRESET_SCALE_VALUES = ['auto', 'page-width', 'page-fit', 'page-actual'] as const;
export type PresetScaleValue = (typeof PRESET_SCALE_VALUES)[number];

export const PERCENT_STEPS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400, 800, 1600, 2500];
export const ZOOM_MENU_PERCENTS = [50, 75, 100, 125, 150, 200, 300, 400];

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function isPresetScaleValue(value: string): value is PresetScaleValue {
  return (PRESET_SCALE_VALUES as readonly string[]).includes(value);
}

export function scaleToPercent(scale: number): number {
  return Math.round(scale * 100);
}

// Wandelt eine Eingabe wie "150", "150 %" oder "150,5" in einen Maßstab um.
export function parsePercentInput(input: string): number | null {
  const cleaned = input.replace('%', '').replace(',', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const percent = Number(cleaned);
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return clampScale(percent / 100);
}

// Sammelt kleine Zoom-Faktoren (Trackpad-Pinch), bis sie eine sichtbare Änderung ergeben.
// pdf.js rundet Maßstäbe auf zwei Nachkommastellen; einzelne Pinch-Ereignisse wären sonst wirkungslos.
export class PinchAccumulator {
  #factor = 1;

  add(currentScale: number, factor: number): number | null {
    this.#factor *= factor;
    const target = clampScale(Math.round(currentScale * this.#factor * 100) / 100);
    if (target === currentScale) return null;
    const applied = this.#factor;
    this.#factor = 1;
    return applied;
  }

  reset(): void {
    this.#factor = 1;
  }
}

// Wheel-Ereignis mit gedrückter Strg-/Cmd-Taste oder Trackpad-Pinch in einen Zoomwunsch übersetzen.
export function wheelZoomIntent(event: { deltaY: number; deltaMode: number }):
  | { kind: 'factor'; factor: number }
  | { kind: 'steps'; steps: number } {
  const PIXEL_MODE = 0;
  // Trackpad und Pinch liefern viele kleine Pixel-Deltas, Mausräder große Sprünge.
  if (event.deltaMode === PIXEL_MODE && Math.abs(event.deltaY) < 40) {
    return { kind: 'factor', factor: Math.exp(-event.deltaY / 100) };
  }
  return { kind: 'steps', steps: event.deltaY < 0 ? 1 : -1 };
}
