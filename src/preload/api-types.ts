// Typen der Schnittstelle, die der Preload dem Renderer als window.blattwerk bereitstellt.
import type { CommandId } from '../shared/commands';
import type {
  ConvertResult,
  AppInfo,
  AppSettings,
  ExportFolderResult,
  ExportImageKind,
  ExportTextResult,
  ExportWriteResult,
  IdFileResult,
  SaveIdResult,
  MenuState,
  NamedBytes,
  OpenResult,
  PickKind,
  PickResult,
  PrintRequest,
  PrintResult,
  RecentFile,
  SaveNewResult,
  SaveResult,
  SaveToFolderResult,
  SavedSignature,
  SignatureInput,
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
  // Quelldateien (PDFs, Bilder) wählen bzw. per Drag & Drop anmelden; gelesen wird danach über readRange.
  pickFiles(kind: PickKind): Promise<PickResult>;
  registerDroppedFile(file: File): Promise<OpenResult>;
  // Neues Dokument über den Sichern-Dialog speichern, auf Wunsch danach im Tab öffnen
  saveNewFile(bytes: Uint8Array, suggestedName: string, referenceFileId: string | null, openAfter: boolean): Promise<SaveNewResult>;
  saveFilesToFolder(files: NamedBytes[], referenceFileId: string | null): Promise<SaveToFolderResult>;
  // Export als Bilder (Phase 6): Ordner wählen, Seite für Seite schreiben, beenden
  exportImages: {
    chooseFolder(referenceFileId: string | null): Promise<ExportFolderResult>;
    write(token: string, name: string, kind: ExportImageKind, bytes: Uint8Array): Promise<ExportWriteResult>;
    end(token: string): Promise<void>;
  };
  // Export als Text über den Sichern-Dialog (UTF-8)
  exportText(text: string, suggestedName: string, referenceFileId: string | null): Promise<ExportTextResult>;
  // Textdokument wählen bzw. abgelegtes umwandeln, als PDF speichern und öffnen
  convertDocument: {
    pick(): Promise<ConvertResult>;
    dropped(file: File): Promise<ConvertResult>;
  };
  // Digitale ID (Phase 7): wählen, zuletzt verwendete laden, neu erstellte speichern
  digitalId: {
    pick(): Promise<IdFileResult>;
    last(): Promise<IdFileResult>;
    save(bytes: Uint8Array, suggestedName: string): Promise<SaveIdResult>;
  };
  signatures: {
    list(): Promise<SavedSignature[]>;
    add(input: SignatureInput): Promise<SavedSignature[]>;
    remove(id: string): Promise<SavedSignature[]>;
  };
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
