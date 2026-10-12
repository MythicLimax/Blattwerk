// Typen der Schnittstelle, die der Preload dem Renderer als window.blattwerk bereitstellt.
import type { CommandId } from '../shared/commands';
import type {
  AppInfo,
  AppSettings,
  MenuState,
  OpenResult,
  PrintRequest,
  PrintResult,
  RecentFile,
  SaveResult,
} from '../shared/ipc';

export interface BlattwerkApi {
  getAppInfo(): Promise<AppInfo>;
  openFileDialog(): Promise<OpenResult[]>;
  // Für Drag & Drop: Der Preload ermittelt den Pfad der Datei, der Renderer sieht ihn nie.
  openDroppedFile(file: File): Promise<OpenResult>;
  readRange(fileId: string, begin: number, end: number): Promise<Uint8Array>;
  closeFile(fileId: string): Promise<void>;
  recent: {
    list(): Promise<RecentFile[]>;
    open(path: string): Promise<OpenResult>;
    remove(path: string): Promise<RecentFile[]>;
    clear(): Promise<RecentFile[]>;
  };
  print(request: PrintRequest): Promise<PrintResult>;
  // Speichert neue Bytes über die geöffnete Datei. force überschreibt auch bei Änderungen von außen.
  saveFile(fileId: string, bytes: Uint8Array, force?: boolean): Promise<SaveResult>;
  saveFileAs(fileId: string, bytes: Uint8Array): Promise<SaveResult>;
  getSettings(): Promise<AppSettings>;
  setAuthorName(name: string): Promise<AppSettings>;
  confirmClose(): void;
  cancelClose(): void;
  onRequestClose(listener: () => void): () => void;
  openExternal(url: string): Promise<boolean>;
  setMenuState(state: MenuState): void;
  signalReady(): void;
  onFileOpened(listener: (result: OpenResult) => void): () => void;
  onMenuCommand(listener: (command: CommandId) => void): () => void;
  onRecentChanged(listener: () => void): () => void;
}
