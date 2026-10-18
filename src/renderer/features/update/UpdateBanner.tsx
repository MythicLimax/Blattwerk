import { Download, Loader2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GLASS, useLiquidGlass } from '../../components/glass/liquid-glass';
import { api } from '../../api';
import { useUpdate } from './update-store';
import styles from './UpdateBanner.module.css';

const MB = 1024 * 1024;

// Hinweis unten in der Mitte: Suche läuft, neue Version wird geladen, oder sie liegt bereit („Jetzt aktualisieren“)
export function UpdateBanner() {
  const { t } = useTranslation();
  const status = useUpdate((s) => s.status);
  const dismissed = useUpdate((s) => s.dismissed);
  const installing = useUpdate((s) => s.installing);
  const searching = useUpdate((s) => s.searching);
  const download = useUpdate((s) => s.download);
  const glassRef = useLiquidGlass<HTMLDivElement>(GLASS.small);

  useEffect(() => {
    const { check, setProgress } = useUpdate.getState();
    void check();
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    // Laden aus dem Netz (auch die stille Suche beim Start)
    const offProgress = api.update.onProgress((progress) => setProgress(progress));
    const offResult = api.update.onResult((result) => {
      setProgress(null);
      if (result.state === 'downloaded') void check();
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      offProgress();
      offResult();
    };
  }, []);

  if (download) {
    const percent = download.total ? Math.min(100, Math.round((download.received / download.total) * 100)) : null;
    return (
      <div ref={glassRef} className={styles.banner} role="status" data-testid="update-banner">
        <Loader2 size={18} strokeWidth={1.75} className={[styles.icon, styles.spin].join(' ')} aria-hidden="true" />
        <div className={styles.text}>
          <strong>{t('update.downloading', { version: download.version })}</strong>
          <span>
            {percent === null
              ? t('update.downloadedMb', { received: Math.round(download.received / MB) })
              : t('update.downloadProgress', { percent, total: Math.round((download.total ?? 0) / MB) })}
          </span>
        </div>
        <div className={styles.progress} aria-hidden="true">
          <div style={{ width: `${percent ?? 0}%` }} />
        </div>
      </div>
    );
  }

  if (status?.state !== 'available' || dismissed === status.version) {
    if (!searching) return null;
    return (
      <div ref={glassRef} className={styles.banner} role="status" data-testid="update-banner">
        <Loader2 size={18} strokeWidth={1.75} className={[styles.icon, styles.spin].join(' ')} aria-hidden="true" />
        <div className={styles.text}>
          <strong>{t('update.searching')}</strong>
        </div>
      </div>
    );
  }
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
