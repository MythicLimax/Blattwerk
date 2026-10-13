// Ausgefüllte, noch nicht gespeicherte Formularwerte je Tab (Phase 4).
import { create } from 'zustand';
import type { FormFieldValue } from '../../shared/forms';

interface FormsState {
  tabs: Record<string, FormFieldValue[]>;
  setChanges: (tabId: string, changes: FormFieldValue[]) => void;
  drop: (tabId: string) => void;
}

const sameChanges = (a: FormFieldValue[] | undefined, b: FormFieldValue[]) => JSON.stringify(a ?? []) === JSON.stringify(b);

export const useForms = create<FormsState>((set) => ({
  tabs: {},
  setChanges: (tabId, changes) =>
    set((state) => (sameChanges(state.tabs[tabId], changes) ? state : { tabs: { ...state.tabs, [tabId]: changes } })),
  drop: (tabId) =>
    set((state) => {
      const tabs = { ...state.tabs };
      delete tabs[tabId];
      return { tabs };
    }),
}));

export function formChanges(tabId: string): FormFieldValue[] {
  return useForms.getState().tabs[tabId] ?? [];
}
