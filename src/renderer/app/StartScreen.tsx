import { FileText, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { handleOpenResult, openWithDialog } from '../engine/session';
import { useUi } from '../state/ui-store';
import styles from './StartScreen.module.css';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function StartScreen() {
  const { t } = useTranslation();
  const recent = useUi((s) => s.recent);
  const setRecent = useUi((s) => s.setRecent);

  return (
    <div className={styles.screen} data-testid="start-screen">
      <div className={styles.inner}>
        <h1 className={styles.title}>{t('start.title')}</h1>
        <button type="button" className={styles.openButton} onClick={() => void openWithDialog()}>
          <FolderOpen size={20} strokeWidth={1.75} aria-hidden="true" />
          {t('start.open')}
        </button>
        <p className={styles.hint}>{t('start.dropHint')}</p>

        <section className={styles.recent} aria-labelledby="recent-heading">
          <div className={styles.recentHeader}>
            <h2 id="recent-heading" className={styles.recentTitle}>
              {t('start.recent')}
            </h2>
            {recent.length > 0 && (
              <button type="button" className={styles.linkButton} onClick={() => void api.recent.clear().then(setRecent)}>
                {t('start.clear')}
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className={styles.empty}>{t('start.noRecent')}</p>
          ) : (
            <ul className={styles.list} data-testid="recent-list">
              {recent.map((file) => (
                <li key={file.path} className={styles.item}>
                  <button
                    type="button"
                    className={styles.itemButton}
                    title={file.path}
                    onClick={() => void api.recent.open(file.path).then(handleOpenResult)}
                  >
                    <FileText size={18} strokeWidth={1.5} aria-hidden="true" className={styles.itemIcon} />
                    <span className={styles.itemText}>
                      <span className={styles.itemName}>{file.name}</span>
                      <span className={styles.itemDir}>{file.dir}</span>
                    </span>
                    <span className={styles.itemDate}>{dateFormat.format(file.openedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={t('start.remove')}
                    data-tooltip={t('start.remove')}
                    onClick={() => void api.recent.remove(file.path).then(setRecent)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
