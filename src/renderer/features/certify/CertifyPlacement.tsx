import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { normalizeRect, type Point } from '../../../shared/annotations';
import type { PageGeometry } from '../../engine/coords';
import { applyDigitalSignature } from '../../engine/session';
import { useCertify } from './certify-store';
import styles from './Certify.module.css';

// Kleinstes Feld; ein einfacher Klick legt ein Feld dieser Vorgabegröße (Punkt) an
const MIN = { width: 60, height: 20 };
const DEFAULT = { width: 200, height: 60 };

// Rechteck für die sichtbare Unterschrift auf einer Seite aufziehen
export function CertifyPlacement({ tabId, pageIndex, geometry }: { tabId: string; pageIndex: number; geometry: PageGeometry }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: Point; to: Point } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useCertify.getState().setPlacement(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const view = (event: ReactPointerEvent): Point => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * geometry.width, y: ((event.clientY - box.top) / box.height) * geometry.height };
  };

  const finish = () => {
    const current = drag;
    setDrag(null);
    const placement = useCertify.getState().placement;
    if (!current || !placement || placement.tabId !== tabId) return;
    const a = geometry.toPdf(current.start.x, current.start.y);
    const b = geometry.toPdf(current.to.x, current.to.y);
    let rect = normalizeRect([a.x, a.y, b.x, b.y]);
    if (rect[2] - rect[0] < MIN.width || rect[3] - rect[1] < MIN.height) {
      // Einfacher Klick: Feld mit Vorgabegröße, linke obere Ecke an der Klickstelle
      rect = normalizeRect([a.x, a.y - DEFAULT.height, a.x + DEFAULT.width, a.y]);
    }
    useCertify.getState().setPlacement(null);
    void applyDigitalSignature(tabId, { ...placement.request, placement: { pageIndex, rect } });
  };

  const box = drag
    ? { left: Math.min(drag.start.x, drag.to.x), top: Math.min(drag.start.y, drag.to.y), width: Math.abs(drag.to.x - drag.start.x), height: Math.abs(drag.to.y - drag.start.y) }
    : null;
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <div
      ref={ref}
      className={styles.placement}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const at = view(event);
        setDrag({ start: at, to: at });
      }}
      onPointerMove={(event) => {
        if (drag) setDrag({ ...drag, to: view(event) });
      }}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
      data-testid={`certify-placement-${pageIndex}`}
    >
      {box && (
        <div
          className={styles.placementRect}
          style={{ left: percent(box.left, geometry.width), top: percent(box.top, geometry.height), width: percent(box.width, geometry.width), height: percent(box.height, geometry.height) }}
        />
      )}
    </div>
  );
}
