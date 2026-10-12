// Prüfungen für Daten, die über IPC aus dem Renderer kommen. Der Renderer gilt als nicht vertrauenswürdig.
import { MAX_READ_CHUNK, type MenuState, type ViewMode } from './ipc';

const VIEW_MODES: readonly ViewMode[] = ['single', 'continuous', 'two-page', 'two-page-continuous'];

export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isFileId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

export function validateReadRange(
  begin: unknown,
  end: unknown,
  size: number,
): { begin: number; end: number } | null {
  if (!isNonNegativeInt(begin) || !isNonNegativeInt(end)) return null;
  if (end < begin || begin > size) return null;
  const clampedEnd = Math.min(end, size);
  if (clampedEnd - begin > MAX_READ_CHUNK) return null;
  return { begin, end: clampedEnd };
}

export function validateMenuState(value: unknown): MenuState | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const bool = (x: unknown) => typeof x === 'boolean';
  if (!bool(v.hasDocument) || !bool(v.canPrint) || !bool(v.sidebarVisible) || !bool(v.rightPanelVisible)) {
    return null;
  }
  if (!isNonNegativeInt(v.tabCount)) return null;
  if (v.viewMode !== null && !VIEW_MODES.includes(v.viewMode as ViewMode)) return null;
  return {
    hasDocument: v.hasDocument as boolean,
    canPrint: v.canPrint as boolean,
    sidebarVisible: v.sidebarVisible as boolean,
    rightPanelVisible: v.rightPanelVisible as boolean,
    tabCount: v.tabCount,
    viewMode: v.viewMode as ViewMode | null,
  };
}

// Nur Web- und Mail-Links dürfen extern geöffnet werden.
export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

// Ein PDF beginnt mit "%PDF-". Die Spezifikation erlaubt Müll davor, Leser suchen in den ersten 1024 Bytes.
export function looksLikePdf(head: Uint8Array): boolean {
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const limit = Math.min(head.length, 1024) - marker.length;
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (head[i + j] !== marker[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
