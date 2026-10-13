import { FileText, Loader2, Lock, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { closeTab } from '../engine/session';
import { useAnnotations } from '../state/annotations-store';
import { isDirtyState } from '../state/dirty';
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

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useDocuments((s) => s.tabs);
  const activeId = useDocuments((s) => s.activeId);
  const setActive = useDocuments((s) => s.setActive);
  const annotationTabs = useAnnotations((s) => s.tabs);
  const historyTabs = useHistory((s) => s.tabs);

  return (
    <div className={styles.bar} role="tablist" aria-label={t('tabs.label')} data-testid="tab-bar">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={[styles.tab, active ? styles.active : ''].join(' ')}
            title={`${tab.dir}/${tab.name}`}
            onClick={() => setActive(tab.id)}
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
            {isDirtyState(annotationTabs[tab.id], historyTabs[tab.id]) && (
              <span className={styles.dirty} title={t('tabs.unsaved')} aria-label={t('tabs.unsaved')} data-testid="tab-dirty" />
            )}
            <button
              type="button"
              className={styles.close}
              aria-label={t('tabs.close')}
              title={t('tabs.close')}
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
