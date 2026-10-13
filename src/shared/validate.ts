// Prüfungen für Daten, die über IPC aus dem Renderer kommen. Der Renderer gilt als nicht vertrauenswürdig.
import { MAX_FILE_NAME, MAX_NEW_FILES, MAX_READ_CHUNK, type MenuState, type NamedBytes, type PickKind, type ViewMode } from './ipc';

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
  const flags = ['hasDocument', 'canPrint', 'sidebarVisible', 'rightPanelVisible', 'canUndo', 'canRedo', 'activeDirty', 'commentToolsVisible', 'organizeMode', 'canAssemble', 'canExtract'];
  if (!flags.every((key) => bool(v[key]))) return null;
  if (!isNonNegativeInt(v.tabCount) || !isNonNegativeInt(v.dirtyCount)) return null;
  if (v.viewMode !== null && !VIEW_MODES.includes(v.viewMode as ViewMode)) return null;
  return {
    hasDocument: v.hasDocument as boolean,
    canPrint: v.canPrint as boolean,
    sidebarVisible: v.sidebarVisible as boolean,
    rightPanelVisible: v.rightPanelVisible as boolean,
    tabCount: v.tabCount,
    viewMode: v.viewMode as ViewMode | null,
    dirtyCount: v.dirtyCount,
    canUndo: v.canUndo as boolean,
    canRedo: v.canRedo as boolean,
    activeDirty: v.activeDirty as boolean,
    commentToolsVisible: v.commentToolsVisible as boolean,
    organizeMode: v.organizeMode as boolean,
    canAssemble: v.canAssemble as boolean,
    canExtract: v.canExtract as boolean,
  };
}

// Neuer Dateiinhalt aus dem Renderer: Bytes, nicht leer, mit PDF-Kopf, höchstens 2 GB.
export function isPdfBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length > 0 && value.length < 2 ** 31 && looksLikePdf(value.subarray(0, 1024));
}

// Macht aus einem vorgeschlagenen Namen einen sicheren Dateinamen ohne Pfadanteile, mit Endung .pdf.
// Entfernt Trennzeichen und in Windows verbotene Zeichen, vermeidet reservierte Gerätenamen (CON, NUL, COM1 …).
export function sanitizeFileName(value: unknown, fallback = 'Dokument'): string {
  const raw = typeof value === 'string' ? value : '';
  let base = raw
    .replace(/\.pdf$/i, '')
    // eslint-disable-next-line no-control-regex -- Steuerzeichen sind in Dateinamen nicht erlaubt
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!base) base = fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(base)) base = `_${base}`;
  const max = MAX_FILE_NAME - '.pdf'.length;
  if (base.length > max) base = base.slice(0, max).trim();
  return `${base}.pdf`;
}

export function isPickKind(value: unknown): value is PickKind {
  return value === 'pdf' || value === 'images' || value === 'pdf-or-images';
}

// Liste neuer Dateien für „in Ordner speichern“: 1 bis MAX_NEW_FILES Einträge mit Namen und PDF-Bytes.
export function validateNamedPdfs(value: unknown): NamedBytes[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_NEW_FILES) return null;
  const result: NamedBytes[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const { name, bytes } = entry as { name: unknown; bytes: unknown };
    if (typeof name !== 'string' || name.length > 1000 || !isPdfBytes(bytes)) return null;
    result.push({ name, bytes });
  }
  return result;
}

export function validateAuthorName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

// Nur Web- und Mail-Links dürfen extern geöffnet werden. Links mit Benutzername oder Passwort im Host-Teil
// (z. B. https://bank.de@boese.example) werden abgelehnt, weil sie Nutzer über das wahre Ziel täuschen.
export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false;
  try {
    const url = new URL(value);
    if (url.username !== '' || url.password !== '') return false;
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

// Pfad, den der Renderer (Drag & Drop) liefert: nur absolute, lokale Pfade.
// Unter Windows keine UNC- oder Gerätepfade (\\server\freigabe, \\?\…), damit ein manipulierter Renderer
// keine Netzwerkzugriffe (und damit keine Anmeldedaten-Weitergabe) auslösen kann.
export function isSafeLocalPath(value: unknown, platform: string): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) return false;
  if (platform === 'win32') {
    if (value.startsWith('\\\\') || value.startsWith('//')) return false;
    return /^[a-zA-Z]:[\\/]/.test(value);
  }
  return value.startsWith('/');
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
