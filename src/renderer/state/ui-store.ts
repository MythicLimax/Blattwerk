import { create } from 'zustand';
import type { RecentFile } from '../../shared/ipc';

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
}));
