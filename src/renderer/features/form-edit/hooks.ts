import { useEffect } from 'react';
import { getRuntime } from '../../engine/runtime';
import { useFormEdit } from '../../state/form-edit-store';
import { openFieldProperties } from './actions';

// Tasten und Klicks neben Feldern im Modus „Formular bearbeiten“. Entfernen läuft über den Befehl edit.delete.
export function useFormEditInput(tabId: string, active: boolean, formEditing: boolean, pagesReady: number): void {
  useEffect(() => {
    if (!active || !formEditing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const store = useFormEdit.getState();
      const selected = store.selected[tabId];
      if (event.key === 'Escape') {
        if (store.tool !== 'select') store.setTool('select');
        else if (selected) store.select(tabId, null);
        else return;
        event.preventDefault();
      } else if (event.key === 'Enter' && selected) {
        event.preventDefault();
        openFieldProperties(tabId, selected);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, formEditing, tabId]);

  // Klick neben ein Feld hebt die Auswahl auf (Klicks auf Felder und Griffe behandelt die Ebene selbst).
  useEffect(() => {
    if (!formEditing) return;
    const container = getRuntime(tabId)?.container;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-field-ref], [data-form-edit-overlay] [data-handle]')) return;
      if (useFormEdit.getState().selected[tabId]) useFormEdit.getState().select(tabId, null);
    };
    container.addEventListener('pointerdown', onPointerDown);
    return () => container.removeEventListener('pointerdown', onPointerDown);
  }, [tabId, formEditing, pagesReady]);
}
