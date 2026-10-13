// Modus „Formular bearbeiten“ (Phase 4): Werkzeug, Auswahl und Eigenschaften-Dialog.
// Die Felder selbst stehen im Dokument; jede Änderung ergibt einen neuen Dokumentstand (history-store).
import { create } from 'zustand';
import type { Rect } from '../../shared/annotations';
import type { FieldKind, FieldSettings } from '../../shared/forms';

export type FieldTool = 'select' | FieldKind;

// Ein Feld (Widget) auf einer Seite, wie die Bearbeitungsebene es aus pdf.js kennt
export interface FieldWidget {
  ref: string;
  pageIndex: number;
  rect: Rect;
  // null: Schaltfläche oder Signaturfeld (nur verschieben, Größe ändern, löschen)
  kind: FieldKind | null;
  settings: FieldSettings;
}

export type FieldDialogState =
  | { mode: 'create'; tabId: string; pageIndex: number; rect: Rect; kind: FieldKind; settings: FieldSettings }
  | { mode: 'edit'; tabId: string; widget: FieldWidget };

interface FormEditState {
  tool: FieldTool;
  // Ausgewähltes Feld je Tab. Nach dem Neuladen ersetzt die Bearbeitungsebene es durch den frischen Stand (gleiche ref).
  selected: Record<string, FieldWidget | null>;
  // Nach dem Anlegen: Feld dieses Namens auswählen, sobald der neue Stand geladen ist
  pendingSelect: Record<string, string | null>;
  // Lage eines Feldes, die gerade übernommen wird (bis zum Neuladen, damit es nicht zurückspringt)
  pendingRect: Record<string, { ref: string; rect: Rect } | null>;
  // Zuletzt benutzte Optionsgruppe je Tab (Vorschlag für den nächsten Knopf)
  lastRadioGroup: Record<string, string>;
  dialog: FieldDialogState | null;
  setTool: (tool: FieldTool) => void;
  select: (tabId: string, widget: FieldWidget | null) => void;
  setPendingSelect: (tabId: string, name: string | null) => void;
  setPendingRect: (tabId: string, pending: { ref: string; rect: Rect } | null) => void;
  setLastRadioGroup: (tabId: string, name: string) => void;
  setDialog: (dialog: FieldDialogState | null) => void;
  drop: (tabId: string) => void;
}

const without = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  const next = { ...record };
  delete next[key];
  return next;
};

export const useFormEdit = create<FormEditState>((set) => ({
  tool: 'select',
  selected: {},
  pendingSelect: {},
  pendingRect: {},
  lastRadioGroup: {},
  dialog: null,
  setTool: (tool) => set({ tool }),
  select: (tabId, widget) => set((state) => (state.selected[tabId] === widget ? state : { selected: { ...state.selected, [tabId]: widget } })),
  setPendingSelect: (tabId, name) => set((state) => ({ pendingSelect: { ...state.pendingSelect, [tabId]: name } })),
  setPendingRect: (tabId, pending) => set((state) => ({ pendingRect: { ...state.pendingRect, [tabId]: pending } })),
  setLastRadioGroup: (tabId, name) => set((state) => ({ lastRadioGroup: { ...state.lastRadioGroup, [tabId]: name } })),
  setDialog: (dialog) => set({ dialog }),
  drop: (tabId) =>
    set((state) => ({
      selected: without(state.selected, tabId),
      pendingSelect: without(state.pendingSelect, tabId),
      pendingRect: without(state.pendingRect, tabId),
      lastRadioGroup: without(state.lastRadioGroup, tabId),
      dialog: state.dialog?.tabId === tabId ? null : state.dialog,
    })),
}));
