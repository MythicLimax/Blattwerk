import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../state/ui-store';
import styles from './Notices.module.css';

const AUTO_DISMISS_MS = 8000;

// Meldungen unten rechts, z. B. wenn eine Datei nicht geöffnet werden konnte oder ein Schritt geklappt hat.
export function Notices() {
  const { t } = useTranslation();
  const notices = useUi((s) => s.notices);
  const dismiss = useUi((s) => s.dismissNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((n) => setTimeout(() => dismiss(n.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
  }, [notices, dismiss]);

  if (notices.length === 0) return null;
  return (
    <div className={styles.stack} role="alert" aria-live="assertive" data-testid="notices">
      {notices.map((notice) => (
        <div key={notice.id} className={notice.tone === 'success' ? styles.success : styles.notice} data-tone={notice.tone}>
          {notice.tone === 'success' ? (
            <CircleCheck size={18} className={styles.icon} aria-hidden="true" />
          ) : (
            <CircleAlert size={18} className={styles.icon} aria-hidden="true" />
          )}
          <div className={styles.text}>
            <div>{notice.message}</div>
            {notice.detail && <div className={styles.detail}>{notice.detail}</div>}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label={t('errors.dismiss')}
            title={t('errors.dismiss')}
            onClick={() => dismiss(notice.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
