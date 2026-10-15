import { CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccessibilityCheck, AccessibilityReport } from '../../../shared/accessibility';
import { Dialog, DialogButton } from '../../components/Dialog';
import { applyAccessibilityFix } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import { useAccessibility } from './accessibility-store';
import { accessibilityReport } from './report';
import styles from './Accessibility.module.css';

const ICONS = { passed: CircleCheck, failed: CircleX, skipped: CircleMinus } as const;

// Ergebnis der Prüfung auf Barrierefreiheit; Sprache, Titel und Tab-Reihenfolge lassen sich direkt beheben
export function AccessibilityDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const pending = accessibilityReport(tab);
  const [state, setState] = useState<{ source: unknown; report: AccessibilityReport | null } | null>(null);
  const [lang, setLang] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const close = () => useAccessibility.getState().setOpen(false);

  useEffect(() => {
    let cancelled = false;
    pending
      ?.then((report) => !cancelled && setState({ source: pending, report }))
      .catch(() => !cancelled && setState({ source: pending, report: null }));
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const report = state?.source === pending ? state.report : undefined;
  const fixable = report?.checks.filter((check) => check.status === 'failed' && check.fixable) ?? [];
  const needs = (code: AccessibilityCheck['code']) => fixable.some((check) => check.code === code);
  const langValue = lang ?? report?.lang ?? 'de-DE';
  const titleValue = title ?? report?.title ?? tab.name.replace(/\.pdf$/i, '');
  const fix = () => {
    void applyAccessibilityFix(tab.id, {
      lang: needs('language') ? langValue.trim() || null : null,
      title: needs('title') ? titleValue.trim() || null : null,
    });
  };
  const failed = report?.checks.filter((check) => check.status === 'failed').length ?? 0;

  return (
    <Dialog
      title={t('accessibility.title')}
      onClose={close}
      width={560}
      testId="accessibility-dialog"
      actions={
        <>
          {fixable.length > 0 && (
            <DialogButton onClick={fix} disabled={tab.working} testId="accessibility-fix">
              {t('accessibility.fix')}
            </DialogButton>
          )}
          <DialogButton onClick={close} primary>
            {t('accessibility.close')}
          </DialogButton>
        </>
      }
    >
      {report === undefined && <p className={styles.muted}>{t('accessibility.checking')}</p>}
      {report === null && <p className={styles.failed}>{t('accessibility.failed')}</p>}
      {report && (
        <>
          <p className={styles.intro} data-testid="accessibility-summary" data-failed={failed}>
            {failed === 0 ? t('accessibility.allPassed') : t('accessibility.someFailed', { count: failed })}
          </p>
          <ul className={styles.list}>
            {report.checks.map((check) => {
              const Icon = ICONS[check.status];
              return (
                <li key={check.code} className={styles.item} data-testid="accessibility-check" data-code={check.code} data-status={check.status}>
                  <Icon size={18} className={`${styles.icon} ${styles[check.status]}`} aria-label={t(`accessibility.status.${check.status}`)} />
                  <div className={styles.itemText}>
                    <p>{t(`accessibility.check.${check.code}.title`)}</p>
                    {check.status === 'failed' && <p className={styles.itemMeta}>{t(`accessibility.check.${check.code}.failed`, { count: check.count ?? 1 })}</p>}
                    {check.status === 'skipped' && <p className={styles.itemMeta}>{t('accessibility.skipped')}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {(needs('language') || needs('title')) && (
            <div className={styles.fixFields}>
              {needs('language') && (
                <label className={fieldStyles.field}>
                  {t('accessibility.language')}
                  <input className={fieldStyles.input} value={langValue} onChange={(event) => setLang(event.target.value)} data-testid="accessibility-lang" />
                </label>
              )}
              {needs('title') && (
                <label className={fieldStyles.field}>
                  {t('accessibility.documentTitle')}
                  <input className={fieldStyles.input} value={titleValue} onChange={(event) => setTitle(event.target.value)} data-testid="accessibility-title" />
                </label>
              )}
            </div>
          )}
          {fixable.length > 0 && <p className={styles.muted}>{t('accessibility.fixHint')}</p>}
          <p className={styles.muted}>{t('accessibility.hint')}</p>
        </>
      )}
    </Dialog>
  );
}
