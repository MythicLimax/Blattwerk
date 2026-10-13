// Menübefehle für Seiten (Menü „Dokument“) und neue Dokumente (Menü „Ablage“).
import type { CommandId } from '../../../shared/commands';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import { useDocuments, type TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { createPdfFromImages, pickSources, rotatePages, targetPages } from './actions';

// Raster „Seiten organisieren“ ein- oder ausschalten. Beim Verlassen zeigt die Hauptansicht die erste ausgewählte Seite.
export function toggleOrganize(tab: TabState): void {
  commitPendingEdits();
  const update = useDocuments.getState().updateTab;
  if (tab.mode === 'organize') {
    const first = tab.pageSelection.length > 0 ? Math.min(...tab.pageSelection) + 1 : tab.currentPage;
    update(tab.id, { mode: 'view', currentPage: first, pageSelection: [] });
    requestAnimationFrame(() => focusViewer(getRuntime(tab.id)));
  } else {
    update(tab.id, { mode: 'organize', pageSelection: [Math.max(0, tab.currentPage - 1)] });
  }
}

function requireAssemble(tab: TabState): boolean {
  if (tab.canAssemble) return true;
  useUi.getState().notify(t('errors.pages.notAllowed'));
  return false;
}

// Liefert true, wenn der Befehl hierher gehört (auch wenn er gerade nichts tun konnte).
export function runPageCommand(command: CommandId, tab: TabState | null): boolean {
  const ui = useUi.getState();
  if (command === 'file.combine') {
    ui.setCombine([]);
    return true;
  }
  if (command === 'file.fromImages') {
    void createPdfFromImages();
    return true;
  }
  if (!command.startsWith('pages.')) return false;
  if (!tab || tab.status !== 'ready' || tab.working) return true;
  const pages = targetPages(tab);
  const last = Math.max(...pages);
  switch (command) {
    case 'pages.organize':
      toggleOrganize(tab);
      return true;
    case 'pages.rotateClockwise':
    case 'pages.rotateCounterClockwise':
      if (requireAssemble(tab)) void rotatePages(tab, pages, command === 'pages.rotateClockwise' ? 90 : 270);
      return true;
    case 'pages.delete':
      if (requireAssemble(tab)) ui.setPageDialog({ kind: 'delete', tabId: tab.id, pages });
      return true;
    case 'pages.insertBlank':
      if (requireAssemble(tab)) ui.setPageDialog({ kind: 'insertBlank', tabId: tab.id, after: last });
      return true;
    case 'pages.insertFromFile':
      if (requireAssemble(tab)) {
        void pickSources('pdf-or-images').then((sources) => {
          if (sources) useUi.getState().setPageDialog({ kind: 'insertFiles', tabId: tab.id, after: last, sources });
        });
      }
      return true;
    case 'pages.extract':
      if (tab.canExtract) ui.setPageDialog({ kind: 'extract', tabId: tab.id, pages });
      return true;
    case 'pages.split':
      if (tab.canExtract) ui.setPageDialog({ kind: 'split', tabId: tab.id });
      return true;
    default:
      return true;
  }
}
