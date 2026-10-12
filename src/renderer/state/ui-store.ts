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
  // Zähler, damit die Suche den Fokus bekommt, auch wenn der Bereich schon offen ist
  searchFocusRequest: number;
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
}));
