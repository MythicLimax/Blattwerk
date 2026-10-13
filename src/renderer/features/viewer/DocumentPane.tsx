import { Loader2, Lock, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { closeTab } from '../../engine/session';
import { OrganizeView } from '../pages/OrganizeView';
import type { TabState } from '../../state/documents-store';
import styles from './DocumentPane.module.css';
import { ViewerHost } from './ViewerHost';

// Inhalt eines Tabs: Ladeanzeige, Fehlermeldung oder die Seitenansicht.
// Alle Tabs bleiben eingehängt, damit Scrollposition und gerenderte Seiten beim Wechseln erhalten bleiben.
export function DocumentPane({ tab, active }: { tab: TabState; active: boolean }) {
  const { t } = useTranslation();
  return (
    <section
      className={[styles.pane, active ? styles.active : styles.hidden].join(' ')}
      aria-hidden={!active}
      data-testid={active ? 'active-pane' : undefined}
    >
      {tab.status === 'ready' && (tab.mode === 'organize' ? <OrganizeView tab={tab} /> : <ViewerHost tab={tab} active={active} />)}
      {tab.working && (
        <div className={styles.working} role="status" data-testid="pages-working">
          <Loader2 size={22} className={styles.spin} aria-hidden="true" />
          <span>{t('pages.busy.working')}</span>
        </div>
      )}
      {tab.status === 'loading' && (
        <div className={styles.center}>
          <Loader2 size={28} className={styles.spin} aria-hidden="true" />
          <span>{t('viewer.loading')}</span>
        </div>
      )}
      {tab.status === 'password' && (
        <div className={styles.center}>
          <Lock size={28} aria-hidden="true" />
        </div>
      )}
      {tab.status === 'error' && (
        <div className={styles.center} role="alert" data-testid="load-error">
          <TriangleAlert size={32} className={styles.errorIcon} aria-hidden="true" />
          <p className={styles.errorText}>{t(tab.errorKey ?? 'errors.load.generic')}</p>
          {tab.errorDetail && <p className={styles.detail}>{t('errors.load.detail', { detail: tab.errorDetail })}</p>}
          <button type="button" className={styles.button} onClick={() => void closeTab(tab.id)}>
            {t('viewer.closeTab')}
          </button>
        </div>
      )}
    </section>
  );
}
