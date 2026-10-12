import type { CommandId } from '../../shared/commands';
import type { OpenResult, ViewMode } from '../../shared/ipc';
import { api } from '../api';
import { printDocument } from '../features/print/print-service';
import { layoutForMode } from '../features/viewer/view-modes';
import { t } from '../i18n';
import { getActiveTab, useDocuments, type TabState } from '../state/documents-store';
import { useUi } from '../state/ui-store';
import { startLoading } from './document-loader';
import { pdfjs } from './pdfjs';
import { createRuntime, destroyRuntime, dispatchFind, getRuntime, setRuntimeDocument } from './runtime';

// Warteschlange für Kennwortabfragen je Tab (pdf.js ruft den Rückruf, bevor das Dokument geöffnet ist).
const passwordCallbacks = new Map<string, (password: string) => void>();
let printAbort: AbortController | null = null;

function errorName(error: unknown): string {
  return typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Übersetzungsschlüssel für einen Ladefehler. Fehler aus IPC tragen ein Präfix von Electron,
// deshalb wird auf enthaltenen Text geprüft.
function loadErrorKey(error: unknown): string {
  if (errorMessage(error).includes('file-changed')) return 'errors.load.changed';
  if (errorName(error) === 'InvalidPDFException') return 'errors.load.invalid';
  return 'errors.load.generic';
}

export async function handleOpenResult(result: OpenResult): Promise<void> {
  if (!result.ok) {
    if (result.error !== 'cancelled') {
      useUi.getState().notify(t(`errors.open.${result.error}`, { name: result.name ?? '' }));
    }
    return;
  }
  const { file } = result;
  const documents = useDocuments.getState();

  // Dieselbe Datei ist schon offen: zum Tab wechseln statt doppelt öffnen.
  const existing = documents.tabs.find((tab) => tab.name === file.name && tab.dir === file.dir && tab.size === file.size);
  if (existing) {
    documents.setActive(existing.id);
    void api.closeFile(file.fileId);
    return;
  }

  const tabId = crypto.randomUUID();
  documents.addTab({ id: tabId, fileId: file.fileId, name: file.name, dir: file.dir, size: file.size });

  try {
    const handle = await startLoading(file, {
      onPassword: (reason, submit) => {
        passwordCallbacks.set(tabId, submit);
        useDocuments.getState().updateTab(tabId, {
          status: 'password',
          passwordIncorrect: reason === 'incorrect',
          openedWithPassword: true,
        });
      },
      onRangeError: (error) => {
        if (!useDocuments.getState().tabs.some((tab) => tab.id === tabId)) return;
        useDocuments.getState().updateTab(tabId, {
          status: 'error',
          errorKey: loadErrorKey(error),
          errorDetail: errorMessage(error),
        });
      },
    });
    if (!useDocuments.getState().tabs.some((tab) => tab.id === tabId)) {
      handle.terminate();
      return;
    }
    const runtime = createRuntime(tabId, file, handle.terminate);
    const pdf = await handle.promise;
    if (!getRuntime(tabId)) return;
    setRuntimeDocument(runtime, pdf);
    const [metadata, permissions] = await Promise.all([
      pdf.getMetadata().catch(() => null),
      pdf.getPermissions().catch(() => null),
    ]);
    const info = (metadata?.info ?? {}) as Record<string, unknown>;
    const title = typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : null;
    useDocuments.getState().updateTab(tabId, {
      status: 'ready',
      pageCount: pdf.numPages,
      title,
      canPrint: permissions === null || permissions.has(pdfjs.PermissionFlag.PRINT),
    });
  } catch (error) {
    if (!useDocuments.getState().tabs.some((tab) => tab.id === tabId)) return;
    useDocuments.getState().updateTab(tabId, {
      status: 'error',
      errorKey: loadErrorKey(error),
      errorDetail: errorMessage(error),
    });
  } finally {
    passwordCallbacks.delete(tabId);
  }
}

export function submitPassword(tabId: string, password: string): void {
  const submit = passwordCallbacks.get(tabId);
  if (!submit) return;
  useDocuments.getState().updateTab(tabId, { status: 'loading' });
  submit(password);
}

export async function openWithDialog(): Promise<void> {
  const results = await api.openFileDialog();
  // Nicht auf das Laden warten: Eine Kennwortabfrage soll die übrigen Dateien nicht aufhalten.
  // Die Tab-Reihenfolge bleibt erhalten, weil handleOpenResult den Tab vor dem ersten await anlegt.
  for (const result of results) void handleOpenResult(result);
}

export function closeTab(tabId: string): void {
  const tab = useDocuments.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  passwordCallbacks.delete(tabId);
  const ui = useUi.getState();
  // Ein laufender Druck dieses Dokuments wird abgebrochen, bevor seine pdf.js-Instanz verschwindet.
  if (ui.print?.tabId === tabId) printAbort?.abort();
  destroyRuntime(tabId);
  void api.closeFile(tab.fileId);
  useDocuments.getState().removeTab(tabId);
  if (ui.propertiesTabId === tabId) ui.openProperties(null);
  // „Gehe zu Seite“ gilt immer dem aktiven Tab; nach dem Schließen ist das ein anderer.
  ui.setGoToPageOpen(false);
}

export function setViewMode(tab: TabState, mode: ViewMode): void {
  useDocuments.getState().updateTab(tab.id, { viewMode: mode });
  const viewer = getRuntime(tab.id)?.viewer;
  if (!viewer) return;
  const page = viewer.currentPageNumber;
  const layout = layoutForMode(mode);
  viewer.scrollMode = layout.scrollMode;
  viewer.spreadMode = layout.spreadMode;
  viewer.currentPageNumber = page;
}

export function setScaleValue(tab: TabState, value: string): void {
  const viewer = getRuntime(tab.id)?.viewer;
  if (!viewer) return;
  viewer.currentScaleValue = value;
  // pdf.js meldet keine Änderung, wenn sich nur die Art (z. B. Automatisch → 125 %) ändert, nicht der Maßstab.
  useDocuments.getState().updateTab(tab.id, { scaleValue: viewer.currentScaleValue || value, scale: viewer.currentScale });
}

export function goToPage(tab: TabState, pageNumber: number): void {
  const viewer = getRuntime(tab.id)?.viewer;
  if (!viewer || tab.pageCount === 0) return;
  viewer.currentPageNumber = Math.min(tab.pageCount, Math.max(1, Math.round(pageNumber)));
}

export async function printTab(tab: TabState): Promise<void> {
  const runtime = getRuntime(tab.id);
  const ui = useUi.getState();
  if (!runtime?.pdf || ui.print) return;
  if (!tab.canPrint) {
    ui.notify(t('print.notAllowed'));
    return;
  }
  printAbort = new AbortController();
  ui.setPrint({ tabId: tab.id, current: 0, total: runtime.pdf.numPages });
  const result = await printDocument(
    runtime.pdf,
    {
      onProgress: (current, total) => useUi.getState().setPrint({ tabId: tab.id, current, total }),
      print: () => api.print({ documentName: tab.title ?? tab.name }),
    },
    printAbort.signal,
  );
  printAbort = null;
  useUi.getState().setPrint(null);
  if (!result.ok && result.reason === 'failed') {
    useUi.getState().notify(t('errors.print.failed'), result.detail);
  }
}

export function cancelPrint(): void {
  printAbort?.abort();
}

const VIEW_MODE_BY_COMMAND: Partial<Record<CommandId, ViewMode>> = {
  'view.modeSingle': 'single',
  'view.modeContinuous': 'continuous',
  'view.modeTwoPage': 'two-page',
  'view.modeTwoPageContinuous': 'two-page-continuous',
};

function switchTab(offset: number): void {
  const { tabs, activeId, setActive } = useDocuments.getState();
  if (tabs.length < 2) return;
  const index = tabs.findIndex((tab) => tab.id === activeId);
  const next = tabs[(index + offset + tabs.length) % tabs.length];
  if (next) setActive(next.id);
}

export function executeCommand(command: CommandId): void {
  const ui = useUi.getState();
  if (command === 'file.open') {
    void openWithDialog();
    return;
  }
  if (command === 'window.nextTab') return switchTab(1);
  if (command === 'window.previousTab') return switchTab(-1);

  const tab = getActiveTab();
  if (!tab) return;
  const runtime = getRuntime(tab.id);
  const viewer = runtime?.viewer ?? null;

  const mode = VIEW_MODE_BY_COMMAND[command];
  if (mode) {
    setViewMode(tab, mode);
    return;
  }

  switch (command) {
    case 'file.close':
      closeTab(tab.id);
      return;
    case 'file.print':
      void printTab(tab);
      return;
    case 'file.properties':
      if (tab.status === 'ready') ui.openProperties(tab.id);
      return;
    case 'edit.find':
      ui.requestSearchFocus();
      return;
    case 'edit.findNext':
    case 'edit.findPrevious':
      if (runtime && tab.search.query) {
        ui.setRightPanelVisible(true);
        dispatchFind(runtime, tab.search, 'again', command === 'edit.findPrevious');
      } else {
        ui.requestSearchFocus();
      }
      return;
    case 'view.toggleSidebar':
      ui.setSidebarVisible(!ui.sidebarVisible);
      return;
    case 'view.toggleRightPanel':
      ui.setRightPanelVisible(!ui.rightPanelVisible);
      return;
    case 'nav.goToPage':
      if (tab.status === 'ready') ui.setGoToPageOpen(true);
      return;
    default:
      break;
  }

  if (!viewer) return;
  switch (command) {
    case 'view.zoomIn':
      viewer.increaseScale();
      return;
    case 'view.zoomOut':
      viewer.decreaseScale();
      return;
    case 'view.fitPage':
      viewer.currentScaleValue = 'page-fit';
      return;
    case 'view.actualSize':
      viewer.currentScaleValue = 'page-actual';
      return;
    case 'view.fitWidth':
      viewer.currentScaleValue = 'page-width';
      return;
    case 'view.rotateClockwise':
      viewer.pagesRotation = (viewer.pagesRotation + 90) % 360;
      return;
    case 'view.rotateCounterClockwise':
      viewer.pagesRotation = (viewer.pagesRotation + 270) % 360;
      return;
    case 'nav.firstPage':
      viewer.currentPageNumber = 1;
      return;
    case 'nav.previousPage':
      viewer.previousPage();
      return;
    case 'nav.nextPage':
      viewer.nextPage();
      return;
    case 'nav.lastPage':
      viewer.currentPageNumber = viewer.pagesCount;
      return;
    default:
      return;
  }
}
