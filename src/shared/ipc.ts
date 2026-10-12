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
  // Renderer → Hauptprozess (send)
  menuState: 'app:menu-state',
  rendererReady: 'app:renderer-ready',
  // Hauptprozess → Renderer
  fileOpened: 'file:opened',
  menuCommand: 'menu:command',
  recentChanged: 'recent:changed',
} as const;

export interface FileInfo {
  fileId: string;
  name: string;
  dir: string;
  size: number;
}

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
