import { useEffect, useRef } from 'react';
import styles from './Tooltip.module.css';

const SHOW_DELAY_MS = 400;
// Wer kurz nach einem Tooltip auf das nächste Symbol fährt, sieht es sofort (wie in macOS).
const WARM_MS = 600;
const GAP = 6;
const MARGIN = 4;

// Eine Beschriftung für die ganze App: zeigt den Text aus data-tooltip unter dem Element, über dem die Maus steht
// (oben, wenn unten kein Platz ist). Liegt als Popover in der obersten Ebene, damit es auch über Dialogen erscheint.
export function TooltipHost() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    let target: HTMLElement | null = null;
    let timer: number | undefined;
    let hiddenAt = 0;

    const place = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const own = tip.getBoundingClientRect();
      const left = Math.min(Math.max(MARGIN, box.left + box.width / 2 - own.width / 2), window.innerWidth - own.width - MARGIN);
      const below = box.bottom + GAP;
      const top = below + own.height + MARGIN <= window.innerHeight ? below : box.top - GAP - own.height;
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
    };

    const show = (element: HTMLElement) => {
      const text = element.dataset.tooltip;
      if (!text || !element.isConnected) return;
      // Nur bei neuem Text schreiben: Das Schreiben selbst würde den MutationObserver unten erneut auslösen.
      if (tip.textContent !== text) tip.textContent = text;
      if (!tip.matches(':popover-open')) tip.showPopover();
      place(element);
    };

    const hide = () => {
      window.clearTimeout(timer);
      if (target && tip.matches(':popover-open')) {
        tip.hidePopover();
        hiddenAt = performance.now();
      }
      target = null;
    };

    const onOver = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest<HTMLElement>('[data-tooltip]') ?? null;
      if (element === target) return;
      hide();
      if (!element || event.buttons !== 0) return;
      target = element;
      const delay = performance.now() - hiddenAt < WARM_MS ? 0 : SHOW_DELAY_MS;
      timer = window.setTimeout(() => show(element), delay);
    };

    const onLeaveWindow = (event: PointerEvent) => {
      if (!event.relatedTarget) hide();
    };

    // Text kann sich ändern, während die Maus darüber steht (z. B. gedrückter Knopf)
    const observer = new MutationObserver(() => {
      if (target && tip.matches(':popover-open')) {
        if (!target.isConnected || !target.dataset.tooltip) hide();
        else show(target);
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-tooltip'], childList: true });

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onLeaveWindow, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onLeaveWindow, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  return <div ref={ref} popover="manual" role="tooltip" className={styles.tooltip} data-testid="tooltip" />;
}
