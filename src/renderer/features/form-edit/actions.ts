// Modus „Formular bearbeiten“ (Phase 4): ein- und ausschalten, Felder anlegen, ändern, verschieben, löschen.
// Jede Änderung ergibt einen neuen Dokumentstand (wie Seitenoperationen); Rückgängig führt zum vorigen Stand.
import type { Rect } from '../../../shared/annotations';
import { DEFAULT_FIELD_SETTINGS, nextFieldName, type FieldKind, type FieldSettings } from '../../../shared/forms';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { applyFieldOperations, commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import { useAnnotations } from '../../state/annotations-store';
import { useDocuments, type TabState } from '../../state/documents-store';
import { useFormEdit, type FieldDialogState, type FieldWidget } from '../../state/form-edit-store';
import { useUi } from '../../state/ui-store';
import { fieldDirectory } from './field-widgets';

export function toggleFormEditing(tab: TabState): void {
  if (tab.status !== 'ready' || tab.mode !== 'view') return;
  const store = useFormEdit.getState();
  if (tab.formEditing) {
    useDocuments.getState().updateTab(tab.id, { formEditing: false });
    store.select(tab.id, null);
    store.setTool('select');
    requestAnimationFrame(() => focusViewer(getRuntime(tab.id)));
    return;
  }
  if (!tab.canEditForms) {
    useUi.getState().notify(t('formEdit.notAllowed'));
    return;
  }
  commitPendingEdits();
  const ui = useUi.getState();
  if (ui.commentToolsVisible) ui.setCommentToolsVisible(false);
  if (ui.redactToolsVisible) ui.setRedactToolsVisible(false);
  if (ui.markToolsVisible) ui.setMarkToolsVisible(false);
  if (tab.contentEditing) useDocuments.getState().updateTab(tab.id, { contentEditing: false });
  useAnnotations.getState().setTool('select');
  useAnnotations.getState().select(tab.id, null);
  store.setTool('select');
  useDocuments.getState().updateTab(tab.id, { formEditing: true });
}

// Nächster freier Wert in einer Optionsgruppe („Auswahl 3“)
function nextRadioValue(values: string[]): string {
  const taken = new Set(values);
  for (let n = values.length + 1; ; n++) {
    const candidate = t('formEdit.defaultValue', { n });
    if (!taken.has(candidate)) return candidate;
  }
}

// Neues Feld aufgezogen: Eigenschaften-Dialog mit Vorschlägen öffnen. Angelegt wird erst beim Bestätigen.
export async function startCreateField(tabId: string, pageIndex: number, rect: Rect, kind: FieldKind): Promise<void> {
  const pdf = getRuntime(tabId)?.pdf;
  if (!pdf) return;
  const directory = await fieldDirectory(pdf);
  let settings: FieldSettings;
  if (kind === 'radio') {
    const last = useFormEdit.getState().lastRadioGroup[tabId];
    const group = last && directory.radioGroups.has(last) ? last : nextFieldName(t('formEdit.defaultName.radio'), directory.names);
    settings = { ...DEFAULT_FIELD_SETTINGS, name: group, exportValue: nextRadioValue(directory.radioGroups.get(group) ?? []) };
  } else {
    settings = { ...DEFAULT_FIELD_SETTINGS, name: nextFieldName(t(`formEdit.defaultName.${kind}`), directory.names) };
  }
  useFormEdit.getState().setDialog({ mode: 'create', tabId, pageIndex, rect, kind, settings });
}

export function openFieldProperties(tabId: string, widget: FieldWidget): void {
  if (!widget.kind) {
    useUi.getState().notify(t('formEdit.notEditable'));
    return;
  }
  useFormEdit.getState().setDialog({ mode: 'edit', tabId, widget });
}

const sameSettings = (a: FieldSettings, b: FieldSettings) => JSON.stringify(a) === JSON.stringify(b);

export async function submitFieldDialog(dialog: FieldDialogState, settings: FieldSettings): Promise<void> {
  const store = useFormEdit.getState();
  store.setDialog(null);
  if (dialog.mode === 'create') {
    store.setPendingSelect(dialog.tabId, settings.name);
    if (dialog.kind === 'radio') store.setLastRadioGroup(dialog.tabId, settings.name);
    const ok = await applyFieldOperations(
      dialog.tabId,
      [{ type: 'createField', pageIndex: dialog.pageIndex, rect: dialog.rect, kind: dialog.kind, settings }],
      { keepScroll: true },
    );
    if (!ok) store.setPendingSelect(dialog.tabId, null);
    return;
  }
  if (sameSettings(dialog.widget.settings, settings)) return;
  if (dialog.widget.kind === 'radio') store.setLastRadioGroup(dialog.tabId, settings.name);
  await applyFieldOperations(dialog.tabId, [{ type: 'updateField', ref: dialog.widget.ref, settings }], { keepScroll: true });
}

// Verschieben oder Größe ändern
export async function moveField(tabId: string, widget: FieldWidget, rect: Rect): Promise<void> {
  const store = useFormEdit.getState();
  store.setPendingRect(tabId, { ref: widget.ref, rect });
  try {
    await applyFieldOperations(tabId, [{ type: 'updateField', ref: widget.ref, rect }], { keepScroll: true });
  } finally {
    store.setPendingRect(tabId, null);
  }
}

export function deleteSelectedField(tab: TabState): boolean {
  const store = useFormEdit.getState();
  const selected = store.selected[tab.id];
  if (!tab.formEditing || !selected) return false;
  store.select(tab.id, null);
  void applyFieldOperations(tab.id, [{ type: 'deleteField', ref: selected.ref }], { keepScroll: true });
  return true;
}
