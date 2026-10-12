import { useEffect, useRef } from 'react';
import { attachViewer, getRuntime } from '../../engine/runtime';
import type { TabState } from '../../state/documents-store';
import styles from './ViewerHost.module.css';
import { PinchAccumulator, wheelZoomIntent } from './zoom';

// Bindet die pdf.js-Seitenansicht in React ein. pdf.js verwaltet den Inhalt des Containers selbst.
export function ViewerHost({ tab, active }: { tab: TabState; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const runtime = getRuntime(tab.id);
    const container = containerRef.current;
    const viewerElement = viewerRef.current;
    if (!runtime || !container || !viewerElement) return;
    const detach = attachViewer(runtime, container, viewerElement);

    // Zoomen mit Trackpad-Pinch oder Strg/Cmd + Mausrad, verankert an der Mausposition.
    const pinch = new PinchAccumulator();
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const viewer = runtime.viewer;
      if (!viewer) return;
      const origin = [event.clientX, event.clientY];
      const intent = wheelZoomIntent(event);
      if (intent.kind === 'factor') {
        const factor = pinch.add(viewer.currentScale, intent.factor);
        if (factor !== null) viewer.updateScale({ scaleFactor: factor, origin, drawingDelay: 300 });
      } else {
        pinch.reset();
        viewer.updateScale({ steps: intent.steps, origin, drawingDelay: 300 });
      }
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', onWheel);
      detach();
    };
    // Der Viewer wird einmal pro Tab erstellt; Änderungen am Tab-Zustand steuern ihn über Befehle.
  }, [tab.id]);

  // Beim Sichtbarwerden Größe neu berechnen (das Fenster kann sich verändert haben) und Fokus setzen.
  useEffect(() => {
    if (!active) return;
    const runtime = getRuntime(tab.id);
    runtime?.viewer?.update();
    containerRef.current?.focus({ preventScroll: true });
  }, [active, tab.id]);

  // Größenänderungen des Bereichs (Seitenleisten ein/aus, Fenstergröße) an pdf.js melden.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const viewer = getRuntime(tab.id)?.viewer;
      if (!viewer) return;
      const value = viewer.currentScaleValue;
      if (value === 'auto' || value === 'page-width' || value === 'page-fit') {
        viewer.currentScaleValue = value;
      }
      viewer.update();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [tab.id]);

  return (
    <div ref={containerRef} className={styles.container} tabIndex={0} data-testid="viewer-container">
      <div ref={viewerRef} className="pdfViewer" />
    </div>
  );
}
