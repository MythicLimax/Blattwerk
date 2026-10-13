// IPC-Vertrag zwischen Hauptprozess, Preload und Renderer.
// Nur Typen und Konstanten, keine Node- oder DOM-Imports.
import type { CommandId } from './commands';

export const IPC = {
  // Renderer → Hauptprozess (invoke)
  openDialog: 'file:open-dialog',
  openDropped: 'file:open-dropped',
  readRange: 'file:read-range',
  closeFile: 'file:close',
  recentList: 'recent:list',
  recentOpen: 'recent:open',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
  appInfo: 'app:info',
  print: 'print:run',
  openExternal: 'shell:open-external',
  saveFile: 'file:save',
  saveFileAs: 'file:save-as',
  settingsGet: 'settings:get',
  settingsSetAuthor: 'settings:set-author',
  // Phase 3: Quelldateien wählen (PDFs, Bilder) und neue Dokumente speichern
  pickFiles: 'files:pick',
  registerDropped: 'files:register-dropped',
  saveNewFile: 'files:save-new',
  saveToFolder: 'files:save-to-folder',
  // Renderer → Hauptprozess (send)
  menuState: 'app:menu-state',
  rendererReady: 'app:renderer-ready',
  closeConfirmed: 'app:close-confirmed',
  closeCancelled: 'app:close-cancelled',
  // Hauptprozess → Renderer
  fileOpened: 'file:opened',
  menuCommand: 'menu:command',
  recentChanged: 'recent:changed',
  requestClose: 'app:request-close',
} as const;

export type FileKind = 'pdf' | 'jpeg' | 'png';

export interface FileInfo {
  fileId: string;
  name: string;
  dir: string;
  size: number;
  // Art der Datei (nur Quelldateien zum Einfügen und Zusammenführen können Bilder sein)
  kind?: FileKind;
}

// Welche Dateien ein Auswahldialog anbietet
export type PickKind = 'pdf' | 'images' | 'pdf-or-images';

export interface PickResult {
  files: FileInfo[];
  // Namen gewählter Dateien, die weder PDF noch JPEG/PNG sind oder sich nicht lesen ließen
  rejected: string[];
}

// target-open: Die gewählte Zieldatei ist gerade in einem Tab geöffnet und darf so nicht ersetzt werden.
export type SaveNewErrorCode = 'cancelled' | 'write-failed' | 'invalid-data' | 'target-open';

// Neues Dokument gespeichert; open ist das Ergebnis des anschließenden Öffnens im Tab (falls gewünscht)
export type SaveNewResult =
  | { ok: true; name: string; open: OpenResult | null }
  | { ok: false; error: SaveNewErrorCode; detail?: string };

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

export type SaveToFolderResult =
  | { ok: true; folder: string; names: string[] }
  | { ok: false; error: SaveNewErrorCode; detail?: string };

// Obergrenzen für neue Dokumente über IPC
export const MAX_NEW_FILES = 1000;
export const MAX_FILE_NAME = 150;

export type OpenErrorCode = 'not-found' | 'not-a-file' | 'not-pdf' | 'unreadable' | 'cancelled';

export type OpenResult =
  | { ok: true; file: FileInfo }
  | { ok: false; error: OpenErrorCode; name?: string };

export interface RecentFile {
  path: string;
  name: string;
  dir: string;
  openedAt: number;
}

export type ViewMode = 'single' | 'continuous' | 'two-page' | 'two-page-continuous';

export interface MenuState {
  hasDocument: boolean;
  canPrint: boolean;
  viewMode: ViewMode | null;
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  tabCount: number;
  // Tabs mit ungespeicherten Änderungen (für Schließen-Rückfrage und den Punkt im Schließen-Knopf)
  dirtyCount: number;
  canUndo: boolean;
  canRedo: boolean;
  activeDirty: boolean;
  commentToolsVisible: boolean;
  // Phase 3: Raster „Seiten organisieren“ aktiv, Seiten zusammenstellen bzw. extrahieren erlaubt
  organizeMode: boolean;
  canAssemble: boolean;
  canExtract: boolean;
}

export type SaveErrorCode = 'changed-externally' | 'cancelled' | 'write-failed' | 'unknown-file' | 'invalid-data';

export type SaveResult = { ok: true; file: FileInfo } | { ok: false; error: SaveErrorCode; detail?: string };

export interface AppSettings {
  authorName: string;
}

export interface AppInfo {
  platform: 'darwin' | 'win32' | 'linux';
  version: string;
  productName: string;
  e2e: boolean;
}

export interface PrintRequest {
  // Name des Dokuments für die Druckwarteschlange
  documentName: string;
}

export type PrintResult = { ok: true } | { ok: false; reason: 'cancelled' | 'failed'; detail?: string };

export type DefaultAppResult = 'opened-settings' | 'show-instructions' | 'already-default';

export interface MenuCommandMessage {
  command: CommandId;
}

// Obergrenze für einen einzelnen Lesezugriff über IPC. Größere Bereiche teilt der Renderer auf.
export const MAX_READ_CHUNK = 16 * 1024 * 1024;
