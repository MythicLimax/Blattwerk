import { ChevronRight, Combine, FilePlus2, FileText, FileType2, FolderOpen, Images, X, type LucideIcon } from 'lucide-react';
import appIcon from '../../../resources/icon.svg?url';
import { useTranslation } from 'react-i18next';
import type { CommandId } from '../../shared/commands';
import { api } from '../api';
import type { Tone } from '../components/tone';
import { executeCommand, handleOpenResult, openWithDialog } from '../engine/session';
import { useUi } from '../state/ui-store';
import styles from './StartScreen.module.css';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

// Neue Dokumente: je Kachel Befehl, Symbol und Farbe des Arbeitsbereichs
const CREATE: Array<{ command: CommandId; key: string; icon: LucideIcon; tone: Tone }> = [
  { command: 'file.newBlank', key: 'blank', icon: FilePlus2, tone: 'edit' },
  { command: 'file.combine', key: 'combine', icon: Combine, tone: 'pages' },
  { command: 'file.fromImages', key: 'fromImages', icon: Images, tone: 'sign' },
  { command: 'file.fromDocument', key: 'fromDocument', icon: FileType2, tone: 'forms' },
];

// Farblegende: welche Farbe für welchen Arbeitsbereich steht
const LEGEND: Tone[] = ['comment', 'edit', 'forms', 'pages', 'redact', 'sign'];

export function StartScreen() {
  const { t } = useTranslation();
  const recent = useUi((s) => s.recent);
  const setRecent = useUi((s) => s.setRecent);

  return (
    <div className={styles.screen} data-testid="start-screen">
      <div className={styles.inner}>
        <header className={styles.masthead}>
          <img className={styles.mark} src={appIcon} alt="" aria-hidden="true" />
          <div>
            <h1 className={styles.title}>{t('start.title')}</h1>
            <p className={styles.tagline}>{t('start.tagline')}</p>
          </div>
        </header>

        <div className={styles.columns}>
          <div className={styles.main}>
            <div className={styles.openRow}>
              <button type="button" className={styles.openButton} onClick={() => void openWithDialog()}>
                <FolderOpen size={19} strokeWidth={1.75} aria-hidden="true" />
                {t('start.open')}
              </button>
              <p className={styles.hint}>{t('start.dropHint')}</p>
            </div>

            <section aria-labelledby="create-heading">
              <h2 id="create-heading" className={styles.sectionTitle}>
                {t('start.create')}
              </h2>
              <div className={styles.tiles}>
                {CREATE.map(({ command, key, icon: Icon, tone }) => (
                  <button key={key} type="button" className={styles.tile} data-tone={tone} onClick={() => executeCommand(command)} data-testid={`start-${key}`}>
                    <span className={styles.tileIcon}>
                      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className={styles.tileText}>
                      <span className={styles.tileTitle}>{t(`start.tiles.${key}.title`)}</span>
                      <span className={styles.tileDetail}>{t(`start.tiles.${key}.detail`)}</span>
                    </span>
                    <ChevronRight size={15} strokeWidth={2} className={styles.chevron} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.legend} aria-labelledby="legend-heading">
              <h2 id="legend-heading" className={styles.sectionTitle}>
                {t('start.legend')}
              </h2>
              <ul className={styles.legendList}>
                {LEGEND.map((tone) => (
                  <li key={tone} data-tone={tone} className={styles.legendItem}>
                    <span className={styles.swatch} aria-hidden="true" />
                    {t(`start.tones.${tone}`)}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className={styles.recent} aria-labelledby="recent-heading">
            <div className={styles.recentHeader}>
              <h2 id="recent-heading" className={styles.sectionTitle}>
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
                    <button type="button" className={styles.itemButton} title={file.path} onClick={() => void api.recent.open(file.path).then(handleOpenResult)}>
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
    </div>
  );
}
