import { useEffect, useRef } from 'react';
import type { MenuState } from '../../shared/ipc';
import { matchRendererShortcut } from '../../shared/shortcuts';
import { api } from '../api';
import { executeCommand, handleOpenResult } from '../engine/session';
import { isPagedMode } from '../features/viewer/view-modes';
import { getActiveTab, useDocuments } from '../state/documents-store';
import { useUi } from '../state/ui-store';

function computeMenuState(): MenuState {
  const { tabs, activeId } = useDocuments.getState();
  const ui = useUi.getState();
  const active = tabs.find((tab) => tab.id === activeId);
  const ready = active?.status === 'ready';
  return {
    hasDocument: ready,
    canPrint: ready && active.canPrint,
    viewMode: ready ? active.viewMode : null,
    sidebarVisible: ui.sidebarVisible,
    rightPanelVisible: ui.rightPanelVisible,
    tabCount: tabs.length,
  };
}

// Hält Häkchen und aktivierte Menüpunkte im nativen Menü passend zum Zustand.
export function useMenuStateSync(): void {
  const last = useRef('');
  useEffect(() => {
    const push = () => {
      const state = computeMenuState();
      const serialized = JSON.stringify(state);
      if (serialized !== last.current) {
        last.current = serialized;
        api.setMenuState(state);
      }
    };
    push();
    const offDocs = useDocuments.subscribe(push);
    const offUi = useUi.subscribe(push);
    return () => {
      offDocs();
      offUi();
    };
  }, []);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// Tasten, die nicht über Menü-Kürzel laufen (Pfeile, Pos1, Ende, Bild auf/ab in Seitenansicht).
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const tab = getActiveTab();
      if (!tab || tab.status !== 'ready') return;
      const command = matchRendererShortcut(event);
      if (command) {
        event.preventDefault();
        executeCommand(command);
        return;
      }
      if (isPagedMode(tab.viewMode) && (event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault();
        executeCommand(event.key === 'PageDown' ? 'nav.nextPage' : 'nav.previousPage');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

// PDFs per Drag & Drop irgendwo ins Fenster ziehen.
export function useFileDrop(): void {
  useEffect(() => {
    let depth = 0;
    const setDragging = useUi.getState().setDraggingFiles;
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      void (async () => {
        for (const file of files) {
          await handleOpenResult(await api.openDroppedFile(file));
        }
      })();
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
