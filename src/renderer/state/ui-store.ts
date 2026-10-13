import { create } from 'zustand';
import type { FileKind, RecentFile } from '../../shared/ipc';
import type { ImageInfo } from '../../shared/image-info';

// Gelesene Quelldatei zum Einfügen oder Zusammenführen (Bytes im Speicher, Kennwort bereits geprüft)
export interface SourceFile {
  name: string;
  kind: FileKind;
  bytes: Uint8Array;
  password: string | null;
  pageCount: number;
  image: ImageInfo | null;
}

// Offener Dialog für Seitenoperationen (Seiten 0-basiert)
export type PageDialog =
  | { kind: 'delete'; tabId: string; pages: number[] }
  | { kind: 'insertBlank'; tabId: string; after: number }
  | { kind: 'insertFiles'; tabId: string; after: number; sources: SourceFile[] }
  | { kind: 'extract'; tabId: string; pages: number[] }
  | { kind: 'split'; tabId: string };

export interface PasswordRequest {
  name: string;
  incorrect: boolean;
  resolve: (password: string | null) => void;
}

export interface Notice {
  id: number;
  message: string;
  detail?: string;
}

export interface PrintProgress {
  tabId: string;
  current: number;
  total: number;
}

interface UiState {
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  propertiesTabId: string | null;
  goToPageOpen: boolean;
  print: PrintProgress | null;
  notices: Notice[];
  recent: RecentFile[];
  draggingFiles: boolean;
  // Zähler, damit die Suche den Fokus bekommt, auch wenn der Bereich schon offen ist.
  // searchFocusHandled merkt sich die zuletzt erfüllte Anforderung, damit ein Tab-Wechsel nicht erneut fokussiert.
  searchFocusRequest: number;
  searchFocusHandled: number;
  // Name für neue Kommentare (aus den Einstellungen)
  authorName: string;
  commentToolsVisible: boolean;
  settingsOpen: boolean;
  // Offene Rückfrage (ungespeicherte Änderungen, von außen geänderte Datei)
  prompt: Prompt | null;
  pageDialog: PageDialog | null;
  // Dialog „Dateien zusammenführen“ mit den bisher gewählten Dateien
  combine: SourceFile[] | null;
  passwordRequest: PasswordRequest | null;
  // Lang laufende Aufgabe ohne Tab (Zusammenführen, Extrahieren …): Übersetzungsschlüssel der Meldung
  busy: string | null;
  // Dateien werden gerade über das Seitenraster gezogen (dort einfügen statt als Tab öffnen)
  fileDropInsert: boolean;
  // Dialog für Unterschriften: Auswahl gespeicherter oder neue anlegen
  signatureDialog: 'choose' | 'create' | null;
  setSidebarVisible: (visible: boolean) => void;
  setRightPanelVisible: (visible: boolean) => void;
  openProperties: (tabId: string | null) => void;
  setGoToPageOpen: (open: boolean) => void;
  setPrint: (progress: PrintProgress | null) => void;
  notify: (message: string, detail?: string) => void;
  dismissNotice: (id: number) => void;
  setRecent: (recent: RecentFile[]) => void;
  setDraggingFiles: (dragging: boolean) => void;
  requestSearchFocus: () => void;
  markSearchFocusHandled: (request: number) => void;
  setAuthorName: (name: string) => void;
  setCommentToolsVisible: (visible: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPrompt: (prompt: Prompt | null) => void;
  setPageDialog: (dialog: PageDialog | null) => void;
  setCombine: (files: SourceFile[] | null) => void;
  setPasswordRequest: (request: PasswordRequest | null) => void;
  setBusy: (busy: string | null) => void;
  setFileDropInsert: (value: boolean) => void;
  setSignatureDialog: (dialog: 'choose' | 'create' | null) => void;
}

export type PromptAnswer = 'save' | 'discard' | 'cancel' | 'overwrite' | 'saveAs';

export interface Prompt {
  kind: 'unsaved' | 'changed-externally';
  tabId: string;
  name: string;
  resolve: (answer: PromptAnswer) => void;
}

let nextNoticeId = 1;

export const useUi = create<UiState>((set) => ({
  sidebarVisible: true,
  rightPanelVisible: false,
  propertiesTabId: null,
  goToPageOpen: false,
  print: null,
  notices: [],
  recent: [],
  draggingFiles: false,
  searchFocusRequest: 0,
  searchFocusHandled: 0,
  authorName: '',
  commentToolsVisible: false,
  settingsOpen: false,
  prompt: null,
  pageDialog: null,
  combine: null,
  passwordRequest: null,
  busy: null,
  fileDropInsert: false,
  signatureDialog: null,
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setRightPanelVisible: (rightPanelVisible) => set({ rightPanelVisible }),
  openProperties: (propertiesTabId) => set({ propertiesTabId }),
  setGoToPageOpen: (goToPageOpen) => set({ goToPageOpen }),
  setPrint: (print) => set({ print }),
  notify: (message, detail) =>
    set((state) => ({ notices: [...state.notices, { id: nextNoticeId++, message, detail }].slice(-5) })),
  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),
  setRecent: (recent) => set({ recent }),
  setDraggingFiles: (draggingFiles) => set({ draggingFiles }),
  requestSearchFocus: () =>
    set((state) => ({ rightPanelVisible: true, searchFocusRequest: state.searchFocusRequest + 1 })),
  markSearchFocusHandled: (request) => set({ searchFocusHandled: request }),
  setAuthorName: (authorName) => set({ authorName }),
  setCommentToolsVisible: (commentToolsVisible) => set({ commentToolsVisible }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPrompt: (prompt) => set({ prompt }),
  setPageDialog: (pageDialog) => set({ pageDialog }),
  setCombine: (combine) => set({ combine }),
  setPasswordRequest: (passwordRequest) => set({ passwordRequest }),
  setBusy: (busy) => set({ busy }),
  setFileDropInsert: (fileDropInsert) => set({ fileDropInsert }),
  setSignatureDialog: (signatureDialog) => set({ signatureDialog }),
}));
