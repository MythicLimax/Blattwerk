import { useEffect } from 'react';
import { getRuntime } from '../../engine/runtime';
import { useContentEdit } from '../../state/content-edit-store';

// Tasten und Klicks neben Objekten im Modus „Inhalt bearbeiten“. Entfernen läuft über den Befehl edit.delete.
export function useContentEditInput(tabId: string, active: boolean, contentEditing: boolean, pagesReady: number): void {
  useEffect(() => {
    if (!active || !contentEditing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key !== 'Escape') return;
      const store = useContentEdit.getState();
      if (store.tool !== 'select') store.setTool('select');
      else if (store.selected[tabId]) store.select(tabId, null);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, contentEditing, tabId]);

  useEffect(() => {
    if (!contentEditing) return;
    const container = getRuntime(tabId)?.container;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-content-edit-overlay] [data-index], [data-content-edit-overlay] [data-handle], textarea')) return;
      if (event.shiftKey || event.metaKey) return;
      if (useContentEdit.getState().selected[tabId]) useContentEdit.getState().select(tabId, null);
    };
    container.addEventListener('pointerdown', onPointerDown);
    return () => container.removeEventListener('pointerdown', onPointerDown);
  }, [tabId, contentEditing, pagesReady]);
}
