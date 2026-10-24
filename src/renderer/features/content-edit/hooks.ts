import { useEffect } from 'react';
import { getRuntime } from '../../engine/runtime';
import { useContentEdit } from '../../state/content-edit-store';
import styles from './ContentEditOverlay.module.css';

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
      const additive = event.shiftKey || event.metaKey;
      // Neben der Seite (grauer Bereich): Auswahlrahmen beginnen, wie in Textprogrammen und Acrobat
      const store = useContentEdit.getState();
      if (event.button === 0 && !target?.closest('.page') && store.tool === 'select' && !store.editing) startOutsideMarquee(tabId, container, event, additive);
      if (additive) return;
      if (store.selected[tabId]) store.select(tabId, null);
    };
    container.addEventListener('pointerdown', onPointerDown);
    return () => container.removeEventListener('pointerdown', onPointerDown);
  }, [tabId, contentEditing, pagesReady]);
}

// Auswahlrahmen, der neben der Seite beginnt: wird über dem Fenster gezeichnet; beim Loslassen wählt die Seite mit der
// größten Überdeckung alle Objekte aus, die er berührt (ContentEditOverlay, gleiche Regel wie auf der Seite).
function startOutsideMarquee(tabId: string, container: HTMLElement, down: PointerEvent, additive: boolean): void {
  down.preventDefault();
  const frame = document.createElement('div');
  frame.className = styles.outsideMarquee ?? '';
  frame.dataset.testid = 'content-marquee-outside';
  let to = { x: down.clientX, y: down.clientY };
  const rect = () => ({
    left: Math.min(down.clientX, to.x),
    top: Math.min(down.clientY, to.y),
    right: Math.max(down.clientX, to.x),
    bottom: Math.max(down.clientY, to.y),
  });
  const draw = () => {
    const r = rect();
    Object.assign(frame.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== down.pointerId) return;
    event.preventDefault();
    to = { x: event.clientX, y: event.clientY };
    if (!frame.isConnected) document.body.append(frame);
    draw();
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== down.pointerId) return;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    frame.remove();
    const r = rect();
    if (event.type !== 'pointerup' || (r.right - r.left < 2 && r.bottom - r.top < 2)) return;
    let best: { pageIndex: number; overlap: number } | null = null;
    for (const svg of container.querySelectorAll<SVGSVGElement>('[data-content-edit-overlay]')) {
      const box = svg.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
      const pageIndex = Number(svg.dataset.pageIndex);
      if (overlap > 0 && Number.isInteger(pageIndex) && (!best || overlap > best.overlap)) best = { pageIndex, overlap };
    }
    if (best) useContentEdit.getState().setMarquee({ tabId, pageIndex: best.pageIndex, ...r, additive });
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}
