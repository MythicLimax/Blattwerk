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
  // Phase 4: gespeicherte Unterschriften
  signaturesList: 'signatures:list',
  signaturesAdd: 'signatures:add',
  signaturesRemove: 'signatures:remove',
  // Phase 6: Export (Bilder in einen gewählten Ordner, Text in eine Datei)
  exportChooseFolder: 'export:choose-folder',
  exportWriteImage: 'export:write-image',
  exportEnd: 'export:end',
  exportSaveText: 'export:save-text',
  // Phase 7: digitale ID (.p12) wählen, zuletzt verwendete laden, neu erstellte speichern
  signingPickId: 'signing:pick-id',
  signingLastId: 'signing:last-id',
  signingSaveId: 'signing:save-id',
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

export type SignatureKind = 'drawn' | 'typed' | 'image';

// Neue Unterschrift aus dem Renderer: PNG-Bytes mit Maßen
export interface SignatureInput {
  kind: SignatureKind;
  png: Uint8Array;
  width: number;
  height: number;
}

// Gespeicherte Unterschrift (PNG als Base64)
export interface SavedSignature {
  id: string;
  kind: SignatureKind;
  png: string;
  width: number;
  height: number;
  created: number;
}

export const MAX_SIGNATURES = 20;
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;
export const MAX_SIGNATURE_SIDE = 4000;

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
  // Phase 4: Modus „Formular bearbeiten“ aktiv bzw. möglich (nicht in verschlüsselten Dokumenten)
  formEditing: boolean;
  canEditForms: boolean;
  // Phase 5: Leiste „Schwärzen“ offen, Markierungen zum Anwenden vorhanden
  redactToolsVisible: boolean;
  hasRedactionMarks: boolean;
  contentEditing: boolean;
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

// Phase 6: Export
export type ExportImageKind = 'png' | 'jpeg';

// Gewählter Ordner für einen Export; token gilt nur für diesen Export und dieses Fenster
export type ExportFolderResult = { ok: true; token: string; folder: string } | { ok: false; error: 'cancelled' };

export type ExportWriteResult = { ok: true; name: string } | { ok: false; error: 'invalid-data' | 'unknown-folder' | 'write-failed'; detail?: string };

export type ExportTextResult = { ok: true; name: string } | { ok: false; error: SaveNewErrorCode; detail?: string };

// Phase 7: digitale ID (PKCS#12)
export type IdFileResult = { ok: true; name: string; bytes: Uint8Array } | { ok: false; error: 'cancelled' | 'unreadable' | 'invalid' };
export type SaveIdResult = { ok: true; name: string } | { ok: false; error: SaveNewErrorCode; detail?: string };
