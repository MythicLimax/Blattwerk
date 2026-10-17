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

// Liegt der Zeiger außerhalb der Tableiste (darüber, darunter oder außerhalb des Fensters)?
function isOutside(bar: HTMLElement | null, event: { clientX: number; clientY: number }): boolean {
  if (!bar) return false;
  const rect = bar.getBoundingClientRect();
  const outsideWindow = event.clientX < 0 || event.clientY < 0 || event.clientX > window.innerWidth || event.clientY > window.innerHeight;
  return outsideWindow || event.clientY < rect.top - DETACH_DISTANCE || event.clientY > rect.bottom + DETACH_DISTANCE;
}

// Tab herausziehen (ADR 0026): Loslassen außerhalb der Tableiste gibt den Tab an das Fenster unter dem Zeiger oder an
// ein neues Fenster an dieser Stelle. Das Festhalten des Zeigers liefert Bewegungen auch außerhalb des Fensters.
function useTabDrag(bar: RefObject<HTMLDivElement | null>) {
  const drag = useRef<TabDrag | null>(null);
  // Nach einem Ziehen keinen Klick auslösen
  const suppressClick = useRef(false);
  const [detaching, setDetaching] = useState<string | null>(null);

  const end = () => {
    drag.current = null;
    setDetaching(null);
  };

  return {
    detaching,
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
      setDetaching(isOutside(bar.current, event) ? current.tabId : null);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      suppressClick.current = current.moved;
      if (current.moved && isOutside(bar.current, event)) {
        // Bildschirmpunkt in denselben Einheiten wie die Fensterlagen im Hauptprozess
        void transferTab(current.tabId, { kind: 'point', x: Math.round(event.screenX), y: Math.round(event.screenY) });
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
            className={[styles.tab, active ? styles.active : '', drag.detaching === tab.id ? styles.detaching : ''].join(' ')}
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
