// „Ungespeichert“ für einen Tab: ungespeicherte Kommentare oder ein Dokumentstand, der nicht der Datei entspricht.
import { isDirty, tabAnnotations, useTabAnnotations, type TabAnnotations } from './annotations-store';
import type { FormFieldValue } from '../../shared/forms';
import { formChanges, useForms } from './forms-store';
import { canRedoHistory, canUndoHistory, historyDirty, tabHistory, useHistory, type TabHistory } from './history-store';

// Ungespeichert: Kommentare, ein Dokumentstand im Arbeitsspeicher oder ausgefüllte Formularfelder
export function isDirtyState(
  annotations: TabAnnotations | undefined,
  history: TabHistory | undefined,
  forms: FormFieldValue[] | undefined = undefined,
): boolean {
  return isDirty(annotations) || historyDirty(history) || Boolean(forms?.length);
}

export function isTabDirty(tabId: string): boolean {
  return isDirtyState(tabAnnotations(tabId), tabHistory(tabId), formChanges(tabId));
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
  const forms = useForms((state) => (tabId ? state.tabs[tabId] : undefined));
  return isDirtyState(useTabAnnotations(tabId), useTabHistory(tabId), forms);
}
