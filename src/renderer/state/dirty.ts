// „Ungespeichert“ für einen Tab: ungespeicherte Kommentare oder ein Dokumentstand, der nicht der Datei entspricht.
import { isDirty, tabAnnotations, useTabAnnotations, type TabAnnotations } from './annotations-store';
import { canRedoHistory, canUndoHistory, historyDirty, tabHistory, useHistory, type TabHistory } from './history-store';

export function isDirtyState(annotations: TabAnnotations | undefined, history: TabHistory | undefined): boolean {
  return isDirty(annotations) || historyDirty(history);
}

export function isTabDirty(tabId: string): boolean {
  return isDirtyState(tabAnnotations(tabId), tabHistory(tabId));
}

export function canUndoState(annotations: TabAnnotations | undefined, history: TabHistory | undefined): boolean {
  return Boolean(annotations?.undo.length) || canUndoHistory(history);
}

export function canRedoState(annotations: TabAnnotations | undefined, history: TabHistory | undefined): boolean {
  return Boolean(annotations?.redo.length) || canRedoHistory(history);
}

export function useTabHistory(tabId: string | undefined): TabHistory | undefined {
  return useHistory((state) => (tabId ? state.tabs[tabId] : undefined));
}

export function useTabDirty(tabId: string | undefined): boolean {
  return isDirtyState(useTabAnnotations(tabId), useTabHistory(tabId));
}
