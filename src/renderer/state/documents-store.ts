import { create } from 'zustand';
import type { ViewMode } from '../../shared/ipc';

export type TabStatus = 'loading' | 'password' | 'ready' | 'error';
export type SidebarTab = 'pages' | 'bookmarks';
export type SearchStatus = 'idle' | 'pending' | 'found' | 'not-found' | 'wrapped-top' | 'wrapped-bottom';

export interface SearchState {
  query: string;
  caseSensitive: boolean;
  entireWord: boolean;
  matchDiacritics: boolean;
  status: SearchStatus;
  current: number;
  total: number;
  // Seiten mit Treffern: Seitenindex (0-basiert) → Anzahl
  pages: Array<{ pageIndex: number; count: number }>;
}

export interface TabState {
  id: string;
  fileId: string;
  name: string;
  dir: string;
  size: number;
  status: TabStatus;
  passwordIncorrect: boolean;
  // true, wenn zum Öffnen ein Kennwort nötig war
  openedWithPassword: boolean;
  errorKey: string | null;
  errorDetail: string | null;
  title: string | null;
  pageCount: number;
  currentPage: number;
  scale: number;
  scaleValue: string;
  viewMode: ViewMode;
  rotation: number;
  canPrint: boolean;
  sidebarTab: SidebarTab;
  search: SearchState;
}

export const EMPTY_SEARCH: SearchState = {
  query: '',
  caseSensitive: false,
  entireWord: false,
  matchDiacritics: false,
  status: 'idle',
  current: 0,
  total: 0,
  pages: [],
};

interface DocumentsState {
  tabs: TabState[];
  activeId: string | null;
  addTab: (tab: Pick<TabState, 'id' | 'fileId' | 'name' | 'dir' | 'size'>) => void;
  updateTab: (id: string, patch: Partial<TabState>) => void;
  updateSearch: (id: string, patch: Partial<SearchState>) => void;
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
}

export const useDocuments = create<DocumentsState>((set) => ({
  tabs: [],
  activeId: null,
  addTab: (tab) =>
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          ...tab,
          status: 'loading',
          passwordIncorrect: false,
          openedWithPassword: false,
          errorKey: null,
          errorDetail: null,
          title: null,
          pageCount: 0,
          currentPage: 1,
          scale: 1,
          scaleValue: 'auto',
          viewMode: 'continuous',
          rotation: 0,
          canPrint: true,
          sidebarTab: 'pages',
          search: EMPTY_SEARCH,
        },
      ],
      activeId: tab.id,
    })),
  updateTab: (id, patch) =>
    set((state) => ({ tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) })),
  updateSearch: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, search: { ...tab.search, ...patch } } : tab)),
    })),
  removeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
      }
      return { tabs, activeId };
    }),
  setActive: (id) => set({ activeId: id }),
}));

export function getActiveTab(): TabState | null {
  const { tabs, activeId } = useDocuments.getState();
  return tabs.find((tab) => tab.id === activeId) ?? null;
}

export function useActiveTab(): TabState | null {
  return useDocuments((state) => state.tabs.find((tab) => tab.id === state.activeId) ?? null);
}
