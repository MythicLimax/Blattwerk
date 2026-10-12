import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { FileInfo } from '../../shared/ipc';
import { useDocuments, type SearchState, type SearchStatus } from '../state/documents-store';
import { joinTextItems, type PageText } from '../features/search/snippet';
import { ThumbnailCache } from '../features/thumbnails/thumbnail-cache';
import { layoutForMode } from '../features/viewer/view-modes';
import { pdfjs, PDFJS_ASSETS } from './pdfjs';
import {
  EventBus,
  FindState,
  GenericL10n,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from './pdfjs-viewer';

// Alles, was zu einem geöffneten Dokument gehört und nicht in den Zustand (zustand) passt:
// pdf.js-Objekte, Worker, Caches. Schlüssel ist die Tab-ID.
export interface DocumentRuntime {
  tabId: string;
  file: FileInfo;
  eventBus: EventBus;
  linkService: PDFLinkService;
  findController: PDFFindController;
  pdf: PDFDocumentProxy | null;
  viewer: PDFViewer | null;
  thumbnails: ThumbnailCache;
  pageTexts: Map<number, Promise<PageText>>;
  terminate: () => void;
}

const runtimes = new Map<string, DocumentRuntime>();
let sharedL10n: GenericL10n | null = null;

function l10n(): GenericL10n {
  sharedL10n ??= new GenericL10n('de');
  return sharedL10n;
}

export function getRuntime(tabId: string): DocumentRuntime | undefined {
  return runtimes.get(tabId);
}

export function createRuntime(tabId: string, file: FileInfo, terminate: () => void): DocumentRuntime {
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({
    eventBus,
    externalLinkTarget: LinkTarget.BLANK,
    externalLinkRel: 'noopener noreferrer nofollow',
  });
  const findController = new PDFFindController({ eventBus, linkService, updateMatchesCountOnProgress: true });
  const runtime: DocumentRuntime = {
    tabId,
    file,
    eventBus,
    linkService,
    findController,
    pdf: null,
    viewer: null,
    thumbnails: new ThumbnailCache(),
    pageTexts: new Map(),
    terminate,
  };
  runtimes.set(tabId, runtime);
  wireEvents(runtime);
  return runtime;
}

export function destroyRuntime(tabId: string): void {
  const runtime = runtimes.get(tabId);
  if (!runtime) return;
  runtimes.delete(tabId);
  runtime.thumbnails.clear();
  runtime.pageTexts.clear();
  try {
    runtime.viewer?.setDocument(null as unknown as PDFDocumentProxy);
  } catch {
    // Der Viewer kann bereits abgebaut sein.
  }
  runtime.viewer = null;
  runtime.pdf = null;
  runtime.terminate();
}

export function setRuntimeDocument(runtime: DocumentRuntime, pdf: PDFDocumentProxy): void {
  runtime.pdf = pdf;
  runtime.linkService.setDocument(pdf, null);
  runtime.findController.setDocument(pdf);
}

// Erstellt die Seitenansicht von pdf.js im übergebenen Container.
export function attachViewer(runtime: DocumentRuntime, container: HTMLDivElement, viewerElement: HTMLDivElement): () => void {
  if (!runtime.pdf) return () => undefined;
  const tab = useDocuments.getState().tabs.find((t) => t.id === runtime.tabId);
  const viewer = new PDFViewer({
    container,
    viewer: viewerElement,
    eventBus: runtime.eventBus,
    linkService: runtime.linkService,
    findController: runtime.findController,
    l10n: l10n(),
    textLayerMode: 1,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    imageResourcesPath: PDFJS_ASSETS.imageResourcesPath,
    enablePermissions: true,
    enableAutoLinking: true,
  });
  runtime.viewer = viewer;
  runtime.linkService.setViewer(viewer);

  const onPagesInit = () => {
    const current = useDocuments.getState().tabs.find((t) => t.id === runtime.tabId);
    const layout = layoutForMode(current?.viewMode ?? 'continuous');
    viewer.scrollMode = layout.scrollMode;
    viewer.spreadMode = layout.spreadMode;
    viewer.currentScaleValue = current?.scaleValue ?? 'auto';
  };
  runtime.eventBus.on('pagesinit', onPagesInit);
  viewer.setDocument(runtime.pdf);
  if (tab?.rotation) viewer.pagesRotation = tab.rotation;

  return () => {
    runtime.eventBus.off('pagesinit', onPagesInit);
    if (runtime.viewer === viewer) {
      runtime.viewer = null;
      try {
        viewer.setDocument(null as unknown as PDFDocumentProxy);
      } catch {
        // ignorieren
      }
    }
  };
}

function findStatus(state: number, previous: boolean): SearchStatus {
  switch (state) {
    case FindState.FOUND:
      return 'found';
    case FindState.NOT_FOUND:
      return 'not-found';
    case FindState.WRAPPED:
      return previous ? 'wrapped-bottom' : 'wrapped-top';
    case FindState.PENDING:
      return 'pending';
    default:
      return 'idle';
  }
}

function pagesWithMatches(controller: PDFFindController): SearchState['pages'] {
  const pages: SearchState['pages'] = [];
  const matches = controller.pageMatches ?? [];
  matches.forEach((pageMatches, pageIndex) => {
    const count = Array.isArray(pageMatches) ? pageMatches.length : 0;
    if (count > 0) pages.push({ pageIndex, count });
  });
  return pages;
}

function wireEvents(runtime: DocumentRuntime): void {
  const { eventBus, tabId } = runtime;
  const update = useDocuments.getState().updateTab;
  const updateSearch = useDocuments.getState().updateSearch;

  eventBus.on('pagechanging', (evt: { pageNumber: number }) => update(tabId, { currentPage: evt.pageNumber }));
  eventBus.on('scalechanging', (evt: { scale: number; presetValue?: string }) =>
    update(tabId, { scale: evt.scale, scaleValue: evt.presetValue ?? String(evt.scale) }),
  );
  eventBus.on('rotationchanging', (evt: { pagesRotation: number }) => update(tabId, { rotation: evt.pagesRotation }));

  let pagesTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePages = () => {
    if (pagesTimer) return;
    pagesTimer = setTimeout(() => {
      pagesTimer = null;
      updateSearch(tabId, { pages: pagesWithMatches(runtime.findController) });
    }, 150);
  };

  eventBus.on('updatefindmatchescount', (evt: { matchesCount: { current: number; total: number } }) => {
    updateSearch(tabId, { current: evt.matchesCount.current, total: evt.matchesCount.total });
    schedulePages();
  });
  eventBus.on(
    'updatefindcontrolstate',
    (evt: { state: number; previous: boolean; matchesCount: { current: number; total: number } }) => {
      updateSearch(tabId, {
        status: findStatus(evt.state, evt.previous),
        current: evt.matchesCount.current,
        total: evt.matchesCount.total,
      });
      schedulePages();
    },
  );

  // Seiten, die der Viewer ohnehin gerendert hat, liefern billige Miniaturen.
  eventBus.on('pagerendered', (evt: { pageNumber: number; source?: { canvas?: HTMLCanvasElement | null } }) => {
    const canvas = evt.source?.canvas;
    const rotation = runtime.viewer?.pagesRotation ?? 0;
    if (canvas) runtime.thumbnails.offerRenderedPage(evt.pageNumber, canvas, rotation);
  });
}

export type FindType = '' | 'again' | 'casesensitivitychange' | 'entirewordchange' | 'diacriticmatchingchange';

export function dispatchFind(runtime: DocumentRuntime, search: SearchState, type: FindType, findPrevious = false): void {
  runtime.eventBus.dispatch('find', {
    source: null,
    type,
    query: search.query,
    caseSensitive: search.caseSensitive,
    entireWord: search.entireWord,
    matchDiacritics: search.matchDiacritics,
    highlightAll: true,
    findPrevious,
  });
}

export function closeFind(runtime: DocumentRuntime): void {
  runtime.eventBus.dispatch('findbarclose', { source: null });
}

// Position eines Treffers im unveränderten Seitentext (so wie pdf.js ihn für die Markierung nutzt).
export function matchPosition(
  runtime: DocumentRuntime,
  pageIndex: number,
  matchIndex: number,
): { start: number; length: number } | null {
  const controller = runtime.findController as unknown as { pageMatchesLength?: number[][] };
  const start = runtime.findController.pageMatches?.[pageIndex]?.[matchIndex] as number | undefined;
  const length = controller.pageMatchesLength?.[pageIndex]?.[matchIndex];
  return start === undefined || length === undefined ? null : { start, length };
}

// Seitentext in der Zählweise der pdf.js-Treffer (siehe snippet.ts). Wird pro Seite einmal geladen.
export function originalPageText(runtime: DocumentRuntime, pageIndex: number): Promise<PageText> {
  let cached = runtime.pageTexts.get(pageIndex);
  if (!cached) {
    const pdf = runtime.pdf;
    cached = pdf
      ? pdf
          .getPage(pageIndex + 1)
          .then((page) => page.getTextContent({ disableNormalization: true }))
          .then((content) => joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>))
      : Promise.resolve({ text: '', breaks: [] });
    runtime.pageTexts.set(pageIndex, cached);
  }
  return cached;
}
