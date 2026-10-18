import { FileText, Loader2, Lock, TriangleAlert, X } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { closeTab, transferTab } from '../engine/session';
import { useAnnotations } from '../state/annotations-store';
import { isDirtyState } from '../state/dirty';
import { useForms } from '../state/forms-store';
import { useHistory } from '../state/history-store';
import { useDocuments, type TabState } from '../state/documents-store';
import styles from './TabBar.module.css';

function TabIcon({ tab }: { tab: TabState }) {
  const common = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
  switch (tab.status) {
    case 'loading':
      return <Loader2 {...common} className={styles.spin} />;
    case 'password':
      return <Lock {...common} />;
    case 'error':
      return <TriangleAlert {...common} />;
    default:
      return <FileText {...common} />;
  }
}

// Ab dieser Bewegung (Pixel) ist ein gedrückter Tab gezogen statt angeklickt
const DRAG_THRESHOLD = 6;
// So weit ober- oder unterhalb der Tableiste gilt ein Tab als herausgezogen
const DETACH_DISTANCE = 24;

interface TabDrag {
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

// Stelle in der Tableiste, an der ein gezogener Tab landet: hinter allen anderen Tabs, deren Mitte links vom Zeiger liegt
function dropIndex(bar: HTMLElement | null, tabId: string, clientX: number): number {
  if (!bar) return 0;
  const others = [...bar.querySelectorAll<HTMLElement>('[role="tab"]')].filter((element) => element.dataset.tabId !== tabId);
  return others.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left + rect.width / 2 < clientX;
  }).length;
}

// Liegt der Zeiger außerhalb der Tableiste (darüber, darunter oder außerhalb des Fensters)?
function isOutside(bar: HTMLElement | null, event: { clientX: number; clientY: number }): boolean {
  if (!bar) return false;
  const rect = bar.getBoundingClientRect();
  const outsideWindow = event.clientX < 0 || event.clientY < 0 || event.clientX > window.innerWidth || event.clientY > window.innerHeight;
  return outsideWindow || event.clientY < rect.top - DETACH_DISTANCE || event.clientY > rect.bottom + DETACH_DISTANCE;
}

// Tab ziehen (ADR 0026): Innerhalb der Tableiste folgt der Tab dem Zeiger und landet beim Loslassen an der neuen Stelle.
// Loslassen außerhalb der Leiste gibt ihn an das Fenster unter dem Zeiger oder an ein neues Fenster an dieser Stelle.
// Das Festhalten des Zeigers liefert Bewegungen auch außerhalb des Fensters. Umsortiert wird erst beim Loslassen, weil
// React beim Umhängen des Elements das Festhalten beenden würde.
function useTabDrag(bar: RefObject<HTMLDivElement | null>) {
  const drag = useRef<TabDrag | null>(null);
  // Nach einem Ziehen keinen Klick auslösen
  const suppressClick = useRef(false);
  const [detaching, setDetaching] = useState<string | null>(null);
  // Gezogener Tab innerhalb der Leiste und seine waagerechte Verschiebung
  const [shift, setShift] = useState<{ tabId: string; dx: number } | null>(null);

  const end = () => {
    drag.current = null;
    setDetaching(null);
    setShift(null);
  };

  return {
    detaching,
    shift,
    suppressClick,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
      drag.current = { tabId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
      suppressClick.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
      current.moved = true;
      const outside = isOutside(bar.current, event);
      setDetaching(outside ? current.tabId : null);
      setShift(outside ? null : { tabId: current.tabId, dx: event.clientX - current.startX });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      suppressClick.current = current.moved;
      if (current.moved && isOutside(bar.current, event)) {
        // Bildschirmpunkt in denselben Einheiten wie die Fensterlagen im Hauptprozess
        void transferTab(current.tabId, { kind: 'point', x: Math.round(event.screenX), y: Math.round(event.screenY) });
      } else if (current.moved) {
        useDocuments.getState().moveTab(current.tabId, dropIndex(bar.current, current.tabId, event.clientX));
      }
      end();
    },
    onPointerCancel: end,
  };
}

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useDocuments((s) => s.tabs);
  const activeId = useDocuments((s) => s.activeId);
  const setActive = useDocuments((s) => s.setActive);
  const annotationTabs = useAnnotations((s) => s.tabs);
  const historyTabs = useHistory((s) => s.tabs);
  const formTabs = useForms((s) => s.tabs);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useTabDrag(bar);

  return (
    <div ref={bar} className={styles.bar} role="tablist" aria-label={t('tabs.label')} data-testid="tab-bar">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-tab-id={tab.id}
            className={[styles.tab, active ? styles.active : '', drag.detaching === tab.id ? styles.detaching : '', drag.shift?.tabId === tab.id ? styles.dragging : ''].join(' ')}
            style={drag.shift?.tabId === tab.id ? { transform: `translateX(${drag.shift.dx}px)` } : undefined}
            title={`${tab.dir}/${tab.name}`}
            onPointerDown={(event) => drag.onPointerDown(event, tab.id)}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.onPointerCancel}
            onClick={() => {
              if (drag.suppressClick.current) drag.suppressClick.current = false;
              else setActive(tab.id);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) void closeTab(tab.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setActive(tab.id);
            }}
            data-testid="tab"
          >
            <TabIcon tab={tab} />
            <span className={styles.name}>{tab.name}</span>
            {isDirtyState(annotationTabs[tab.id], historyTabs[tab.id], formTabs[tab.id]) && (
              <span className={styles.dirty} data-tooltip={t('tabs.unsaved')} aria-label={t('tabs.unsaved')} data-testid="tab-dirty" />
            )}
            <button
              type="button"
              className={styles.close}
              aria-label={t('tabs.close')}
              data-tooltip={t('tabs.close')}
              onClick={(event) => {
                event.stopPropagation();
                void closeTab(tab.id);
              }}
            >
              <X size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
