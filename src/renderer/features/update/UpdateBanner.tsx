import { Download, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GLASS, useLiquidGlass } from '../../components/glass/liquid-glass';
import { useUpdate } from './update-store';
import styles from './UpdateBanner.module.css';

// Hinweis unten rechts: neue Version liegt bereit, mit „Jetzt aktualisieren“
export function UpdateBanner() {
  const { t } = useTranslation();
  const status = useUpdate((s) => s.status);
  const dismissed = useUpdate((s) => s.dismissed);
  const installing = useUpdate((s) => s.installing);
  const glassRef = useLiquidGlass<HTMLDivElement>(GLASS.small);

  useEffect(() => {
    const { check } = useUpdate.getState();
    void check();
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (status?.state !== 'available' || dismissed === status.version) return null;
  return (
    <div ref={glassRef} className={styles.banner} role="status" data-testid="update-banner">
      <Download size={18} strokeWidth={1.75} className={styles.icon} aria-hidden="true" />
      <div className={styles.text}>
        <strong>{t('update.ready', { version: status.version })}</strong>
        <span>{t('update.detail', { current: status.current })}</span>
      </div>
      <button type="button" className={styles.install} disabled={installing} onClick={() => void useUpdate.getState().install()} data-testid="update-install">
        {t('update.install')}
      </button>
      <button type="button" className={styles.close} aria-label={t('update.later')} data-tooltip={t('update.later')} onClick={() => useUpdate.getState().dismiss()}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
