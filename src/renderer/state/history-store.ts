// Verlauf der Dokumentstände je Tab (Phase 3). Jede Seitenoperation erzeugt einen neuen Stand im Arbeitsspeicher;
// Rückgängig/Wiederholen wechselt zwischen den Ständen. Kommentarbefehle innerhalb eines Stands verwaltet
// weiterhin annotations-store; beim Verlassen eines Stands wird dessen Kommentarzustand hier mitgesichert.
import { create } from 'zustand';
import type { TabAnnotations } from './annotations-store';

export interface DocState {
  // null = die Datei auf der Platte (Stand beim Öffnen bzw. letzten Speichern)
  bytes: Uint8Array | null;
  // Kommentarzustand beim Verlassen des Stands; null = beim Laden aus dem Dokument neu einlesen
  annotations: TabAnnotations | null;
  // Seite, die beim Zurückkehren angezeigt wird (1-basiert)
  page: number;
  // Auswahl im Raster „Seiten organisieren“ beim Verlassen (0-basiert)
  selection: number[];
}

// Was beim Verlassen eines Stands mitgesichert wird
export interface Leaving {
  annotations: TabAnnotations | null;
  page: number;
  selection: number[];
}

export interface TabHistory {
  states: DocState[];
  cursor: number;
  // Index des Stands, der der Datei auf der Platte entspricht; -1 = nicht mehr im Verlauf
  savedCursor: number;
}

// Obergrenze für alle Stände eines Tabs im Arbeitsspeicher. Darüber fallen die ältesten weg.
export const MAX_HISTORY_BYTES = 768 * 1024 * 1024;

const fresh = (): TabHistory => ({ states: [{ bytes: null, annotations: null, page: 1, selection: [] }], cursor: 0, savedCursor: 0 });

const sizeOf = (states: DocState[]) => states.reduce((sum, state) => sum + (state.bytes?.byteLength ?? 0), 0);

// Älteste Stände entfernen, bis die Grenze eingehalten ist. Der aktuelle Stand bleibt immer.
export function trimHistory(history: TabHistory, limit = MAX_HISTORY_BYTES): TabHistory {
  let { states, cursor, savedCursor } = history;
  while (sizeOf(states) > limit && cursor > 0) {
    states = states.slice(1);
    cursor--;
    savedCursor = savedCursor > 0 ? savedCursor - 1 : -1;
  }
  return { states, cursor, savedCursor };
}

interface HistoryState {
  tabs: Record<string, TabHistory>;
  // Neuer Verlauf (Öffnen, nach dem Speichern): nur der Stand der Datei
  reset: (tabId: string) => void;
  drop: (tabId: string) => void;
  // Neuer Stand nach einer Seitenoperation. `leaving` ist der Kommentarzustand des bisherigen Stands.
  push: (tabId: string, leaving: Leaving, next: DocState) => void;
  // Wechsel zu einem anderen Stand; liefert ihn zurück (oder null, wenn es ihn nicht gibt)
  moveTo: (tabId: string, index: number, leaving: Leaving) => DocState | null;
  // Neue Kommentaraktion: Wiederholen von Seitenoperationen ist nicht mehr möglich
  dropRedo: (tabId: string) => void;
}

export const useHistory = create<HistoryState>((set, get) => {
  const patch = (tabId: string, fn: (history: TabHistory) => TabHistory) =>
    set((state) => {
      const history = state.tabs[tabId];
      return history ? { tabs: { ...state.tabs, [tabId]: fn(history) } } : state;
    });
  const remember = (history: TabHistory, leaving: Leaving): DocState[] =>
    history.states.map((state, i) => (i === history.cursor ? { ...state, ...leaving } : state));

  return {
    tabs: {},
    reset: (tabId) => set((state) => ({ tabs: { ...state.tabs, [tabId]: fresh() } })),
    drop: (tabId) =>
      set((state) => {
        const tabs = { ...state.tabs };
        delete tabs[tabId];
        return { tabs };
      }),
    push: (tabId, leaving, next) =>
      patch(tabId, (history) => {
        const states = [...remember(history, leaving).slice(0, history.cursor + 1), next];
        const savedCursor = history.savedCursor > history.cursor ? -1 : history.savedCursor;
        return trimHistory({ states, cursor: states.length - 1, savedCursor });
      }),
    moveTo: (tabId, index, leaving) => {
      const history = get().tabs[tabId];
      if (!history || index < 0 || index >= history.states.length || index === history.cursor) return null;
      patch(tabId, (h) => ({ ...h, states: remember(h, leaving), cursor: index }));
      return get().tabs[tabId]?.states[index] ?? null;
    },
    dropRedo: (tabId) =>
      patch(tabId, (history) => {
        if (history.cursor === history.states.length - 1) return history;
        return {
          states: history.states.slice(0, history.cursor + 1),
          cursor: history.cursor,
          savedCursor: history.savedCursor > history.cursor ? -1 : history.savedCursor,
        };
      }),
  };
});

export function tabHistory(tabId: string): TabHistory | undefined {
  return useHistory.getState().tabs[tabId];
}

// Der angezeigte Stand liegt im Arbeitsspeicher oder weicht vom gespeicherten ab.
export function historyDirty(history: TabHistory | undefined): boolean {
  return Boolean(history) && (history as TabHistory).cursor !== (history as TabHistory).savedCursor;
}

export function canUndoHistory(history: TabHistory | undefined): boolean {
  return Boolean(history && history.cursor > 0);
}

export function canRedoHistory(history: TabHistory | undefined): boolean {
  return Boolean(history && history.cursor < history.states.length - 1);
}
