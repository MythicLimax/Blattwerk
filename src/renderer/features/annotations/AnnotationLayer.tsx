import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Annotation } from '../../../shared/annotations';
import { getRuntime } from '../../engine/runtime';
import { MARKUP_TOOLS, useAnnotations, useTabAnnotations, type Tool } from '../../state/annotations-store';
import { useDocuments } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { geometryFromViewport, type PageGeometry } from '../../engine/coords';
import { ContentEditOverlay } from '../content-edit/ContentEditOverlay';
import { CertifyPlacement } from '../certify/CertifyPlacement';
import { useCertify } from '../certify/certify-store';
import { useContentEditInput } from '../content-edit/hooks';
import { FormEditOverlay } from '../form-edit/FormEditOverlay';
import { useFormEditInput } from '../form-edit/hooks';
import { addAnnotation, baseFields, hideDomAnnotations, updateAnnotation } from './controller';
import { createMarkup, createRedaction } from './create';
import { isMovable, quadsFromRects, translate } from './geometry';
import styles from './PageOverlay.module.css';
import { PageOverlay } from './PageOverlay';
import { selectedTextRects } from './text-selection';

// Pfeiltaste → Richtung in der Ansicht (x nach rechts, y nach unten)
const ARROW_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

// Wie weit außerhalb des sichtbaren Bereichs Seiten schon ihre Kommentarebene bekommen
const PRELOAD_MARGIN = '100% 0px';

// Markiert die aktuelle Textauswahl mit dem gewählten Markierungswerkzeug (auch „Text schwärzen“).
// Liefert true, wenn etwas markiert wurde.
export function markupSelection(tabId: string, tool: Tool, geometryOf: (page: number) => PageGeometry | undefined): boolean {
  const runtime = getRuntime(tabId);
  const container = runtime?.container;
  if (!container || !MARKUP_TOOLS.includes(tool)) return false;
  const selection = window.getSelection();
  const pages = selectedTextRects(selection, container, geometryOf);
  const color = useAnnotations.getState().colors[tool];
  let created = false;
  for (const { pageIndex, rects } of pages) {
    const quads = quadsFromRects(rects);
    if (quads.length === 0) continue;
    const base = baseFields(pageIndex);
    addAnnotation(tabId, tool === 'redactText' ? createRedaction(base, [0, 0, 0, 0], quads, color) : createMarkup(base, tool as 'highlight', quads, color));
    created = true;
  }
  if (created) {
    selection?.removeAllRanges();
    // Modus „Markieren“: neue Markierungen bleiben unausgewählt; Farbe und Art gelten dann für die nächste, und die
    // Anfasser stören das Weitermarkieren nicht. Ein Klick auf eine Markierung wählt sie zum Ändern aus.
    if (useUi.getState().markToolsVisible) useAnnotations.getState().select(tabId, null);
  }
  return created;
}

// Textmarkierung (Hervorheben, Unterstreichen, Durchstreichen) an einem Bildschirmpunkt; die oberste gewinnt
function markupAt(tabId: string, container: HTMLElement, clientX: number, clientY: number): string | null {
  const items = useAnnotations.getState().tabs[tabId]?.items ?? [];
  for (const svg of container.querySelectorAll<SVGSVGElement>('[data-annotation-overlay]')) {
    const box = svg.getBoundingClientRect();
    if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue;
    const pageIndex = Number(svg.dataset.annotationOverlay);
    const geometry = cachedGeometry(tabId, pageIndex);
    if (!geometry) return null;
    const at = geometry.toPdf(((clientX - box.left) / box.width) * geometry.width, ((clientY - box.top) / box.height) * geometry.height);
    const hit = items.findLast(
      (a) =>
        a.pageIndex === pageIndex &&
        (a.kind === 'highlight' || a.kind === 'underline' || a.kind === 'strikeout' || a.kind === 'squiggly') &&
        a.quads.some((q) => {
          const xs = q.map((p) => p.x);
          const ys = q.map((p) => p.y);
          return at.x >= Math.min(...xs) - 1 && at.x <= Math.max(...xs) + 1 && at.y >= Math.min(...ys) - 1 && at.y <= Math.max(...ys) + 1;
        }),
    );
    return hit?.id ?? null;
  }
  return null;
}

// Seitengeometrie (Maßstab 1, mit Drehung) für Markierungen aus der Textauswahl, auch ohne gerenderte Ebene.
const geometryCache = new Map<string, Map<number, PageGeometry>>();

export function cachedGeometry(tabId: string, pageIndex: number): PageGeometry | undefined {
  return geometryCache.get(tabId)?.get(pageIndex);
}

// Hängt je sichtbarer Seite eine Kommentarebene in die Seite von pdf.js.
export function AnnotationLayer({ tabId, active }: { tabId: string; active: boolean }) {
  const annotations = useTabAnnotations(tabId);
  const tool = useAnnotations((s) => s.tool);
  const rotation = useDocuments((s) => s.tabs.find((t) => t.id === tabId)?.rotation ?? 0);
  const scale = useDocuments((s) => s.tabs.find((t) => t.id === tabId)?.scale ?? 1);
  const canAnnotate = useDocuments((s) => s.tabs.find((t) => t.id === tabId)?.canAnnotate ?? false);
  // Modus „Formular bearbeiten“: Kommentare bleiben sichtbar, reagieren aber nicht auf die Maus.
  const formEditing = useDocuments((s) => s.tabs.find((t) => t.id === tabId)?.formEditing ?? false);
  const contentEditing = useDocuments((s) => s.tabs.find((t) => t.id === tabId)?.contentEditing ?? false);
  const placingCertificate = useCertify((s) => s.placement?.tabId === tabId);
  const [visible, setVisible] = useState<number[]>([]);
  const [geometries, setGeometries] = useState<Map<number, PageGeometry>>(new Map());
  const [pagesReady, setPagesReady] = useState(0);
  // Eigene Elemente in den Seiten von pdf.js (eines je Seite, wird wiederverwendet)
  const [hosts] = useState(() => new Map<number, HTMLDivElement>());

  // Seiten von pdf.js beobachten: sichtbar ja/nein, und eigene Ebene nach jedem Neuaufbau wieder einhängen.
  useEffect(() => {
    const runtime = getRuntime(tabId);
    if (!runtime) return;
    let intersection: IntersectionObserver | null = null;
    let mutation: MutationObserver | null = null;
    const shown = new Set<number>();

    const attachHosts = () => {
      const viewer = getRuntime(tabId)?.viewer;
      if (!viewer) return;
      for (const pageIndex of shown) {
        const div = viewer.getPageView(pageIndex)?.div as HTMLElement | undefined;
        const host = hosts.get(pageIndex);
        if (div && host && host.parentElement !== div) div.append(host);
      }
    };

    const setup = () => {
      const viewer = runtime.viewer;
      const container = runtime.container;
      if (!viewer || !container || viewer.pagesCount === 0) return;
      intersection?.disconnect();
      mutation?.disconnect();
      shown.clear();
      intersection = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const number = Number((entry.target as HTMLElement).dataset.pageNumber);
            if (!Number.isInteger(number)) continue;
            if (entry.isIntersecting) shown.add(number - 1);
            else shown.delete(number - 1);
          }
          for (const pageIndex of shown) {
            if (!hosts.has(pageIndex)) {
              const host = document.createElement('div');
              host.className = styles.host ?? '';
              hosts.set(pageIndex, host);
            }
          }
          attachHosts();
          setVisible([...shown].sort((a, b) => a - b));
        },
        { root: container, rootMargin: PRELOAD_MARGIN },
      );
      for (let i = 0; i < viewer.pagesCount; i++) {
        const div = viewer.getPageView(i)?.div as HTMLElement | undefined;
        if (div) intersection.observe(div);
      }
      // pdf.js leert beim Neuzeichnen einer Seite ihren Inhalt; die eigene Ebene sofort zurückholen.
      mutation = new MutationObserver(attachHosts);
      mutation.observe(viewer.viewer as HTMLElement, { childList: true, subtree: true });
      setPagesReady((n) => n + 1);
    };

    const onAnnotationLayer = (event: { source?: { div?: HTMLElement } }) => {
      if (event.source?.div) hideDomAnnotations(tabId, event.source.div);
    };
    runtime.eventBus.on('pagesinit', setup);
    runtime.eventBus.on('annotationlayerrendered', onAnnotationLayer);
    setup();
    return () => {
      runtime.eventBus.off('pagesinit', setup);
      runtime.eventBus.off('annotationlayerrendered', onAnnotationLayer);
      intersection?.disconnect();
      mutation?.disconnect();
      for (const host of hosts.values()) host.remove();
      hosts.clear();
      geometryCache.delete(tabId);
    };
  }, [tabId, hosts]);

  // Seitengeometrie der sichtbaren Seiten aus pdf.js holen (Seitengröße und Drehung)
  useEffect(() => {
    const runtime = getRuntime(tabId);
    const pdf = runtime?.pdf;
    if (!pdf) return;
    let cancelled = false;
    const cache = geometryCache.get(tabId) ?? new Map<number, PageGeometry>();
    geometryCache.set(tabId, cache);
    void (async () => {
      const next = new Map<number, PageGeometry>();
      for (const pageIndex of visible) {
        try {
          const page = await pdf.getPage(pageIndex + 1);
          const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
          const geometry = geometryFromViewport(viewport);
          next.set(pageIndex, geometry);
          cache.set(pageIndex, geometry);
        } catch {
          // Seite nicht lesbar: keine Kommentarebene
        }
      }
      if (!cancelled) setGeometries(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tabId, visible, rotation, pagesReady]);

  // Markierungswerkzeug aktiv: Nach dem Auswählen von Text sofort markieren.
  useEffect(() => {
    if (!active || !canAnnotate || !MARKUP_TOOLS.includes(tool)) return;
    const container = getRuntime(tabId)?.container;
    if (!container) return;
    const onPointerUp = (event: PointerEvent) => {
      // Ziehen an einem Anfasser (der Zeiger bleibt bei ihm) ändert eine Markierung und legt keine neue an
      if ((event.target as Element | null)?.closest('[data-handle]')) {
        window.getSelection()?.removeAllRanges();
        return;
      }
      const { clientX, clientY } = event;
      // Die Auswahl steht erst nach dem Ereignis fest.
      setTimeout(() => {
        if (markupSelection(tabId, tool, (page) => cachedGeometry(tabId, page))) return;
        // Nur geklickt (nichts ausgewählt): eine vorhandene Textmarkierung an dieser Stelle auswählen
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        const hit = markupAt(tabId, container, clientX, clientY);
        if (hit) useAnnotations.getState().select(tabId, hit);
      }, 0);
    };
    container.addEventListener('pointerup', onPointerUp);
    return () => container.removeEventListener('pointerup', onPointerUp);
  }, [active, canAnnotate, tool, tabId, pagesReady]);

  // Esc beendet das Werkzeug bzw. die Auswahl; Pfeiltasten verschieben den ausgewählten Kommentar.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const store = useAnnotations.getState();
      const tab = store.tabs[tabId];
      if (event.key === 'Escape') {
        if (store.tool !== 'select') store.setTool('select');
        else if (tab?.selectedId) store.select(tabId, null);
        else return;
        event.preventDefault();
        return;
      }
      const step = ARROW_STEPS[event.key];
      const selected = tab?.items.find((a) => a.id === tab.selectedId);
      if (!step || !selected || !canAnnotate || !isMovable(selected) || event.metaKey || event.ctrlKey || event.altKey) return;
      const geometry = cachedGeometry(tabId, selected.pageIndex);
      if (!geometry) return;
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const origin = geometry.toPdf(0, 0);
      const moved = geometry.toPdf(step[0] * distance, step[1] * distance);
      updateAnnotation(tabId, selected, translate(selected, moved.x - origin.x, moved.y - origin.y));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, tabId, canAnnotate]);

  // Klick neben einen Kommentar hebt die Auswahl auf. Klicks auf der eigenen Ebene (Kommentar, Griff,
  // Zeichenwerkzeug) behandelt diese selbst; React meldet sie dort früher, weil es auch an Portalen lauscht.
  useEffect(() => {
    const container = getRuntime(tabId)?.container;
    if (!container) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-annotation-overlay], textarea')) return;
      const tab = useAnnotations.getState().tabs[tabId];
      if (tab?.selectedId) useAnnotations.getState().select(tabId, null);
    };
    container.addEventListener('pointerdown', onPointerDown);
    return () => container.removeEventListener('pointerdown', onPointerDown);
  }, [tabId, pagesReady]);

  useFormEditInput(tabId, active, formEditing, pagesReady);
  useContentEditInput(tabId, active, contentEditing, pagesReady);

  const byPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of annotations?.items ?? []) {
      const list = map.get(a.pageIndex) ?? [];
      list.push(a);
      map.set(a.pageIndex, list);
    }
    return map;
  }, [annotations?.items]);

  if (!annotations) return null;
  return (
    <>
      {visible.map((pageIndex) => {
        const host = hosts.get(pageIndex);
        const geometry = geometries.get(pageIndex);
        if (!host || !geometry) return null;
        return createPortal(
          <>
            <PageOverlay
              tabId={tabId}
              pageIndex={pageIndex}
              geometry={geometry}
              items={byPage.get(pageIndex) ?? []}
              originals={annotations.originals}
              selectedId={annotations.selectedId}
              editingId={annotations.editingId}
              scale={scale}
              readOnly={!canAnnotate || formEditing || contentEditing}
              inert={formEditing || contentEditing}
            />
            {formEditing && <FormEditOverlay tabId={tabId} pageIndex={pageIndex} geometry={geometry} scale={scale} />}
            {contentEditing && <ContentEditOverlay tabId={tabId} pageIndex={pageIndex} geometry={geometry} scale={scale} />}
            {placingCertificate && <CertifyPlacement tabId={tabId} pageIndex={pageIndex} geometry={geometry} />}
          </>,
          host,
          `page-${pageIndex}`,
        );
      })}
    </>
  );
}
