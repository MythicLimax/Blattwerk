import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { TabState } from '../../state/documents-store';
import { saveAsPdfA } from './actions';
import { usePdfA } from './pdfa-store';
import styles from './PdfA.module.css';

// Ergebnis der PDF/A-Prüfung und Umwandeln in eine neue Datei
export function PdfADialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const report = usePdfA((state) => state.report);
  const close = () => usePdfA.getState().setOpen(false);
  const convert = () => {
    close();
    void saveAsPdfA(tab);
  };
  const compliant = report !== null && report.declared !== null && report.issues.length === 0;
  return (
    <Dialog
      title={t('pdfa.title')}
      onClose={close}
      width={520}
      testId="pdfa-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('pdfa.close')}</DialogButton>
          <DialogButton onClick={convert} primary disabled={report === null} testId="pdfa-convert">
            {t('pdfa.convert')}
          </DialogButton>
        </>
      }
    >
      <p className={styles.intro}>{t('pdfa.intro')}</p>
      {report === null ? (
        <p className={styles.muted}>{t('pdfa.checking')}</p>
      ) : (
        <>
          <p className={styles.verdict} data-testid="pdfa-verdict" data-compliant={compliant}>
            {compliant ? <CircleCheck size={20} className={styles.ok} aria-hidden="true" /> : <CircleAlert size={20} className={styles.warning} aria-hidden="true" />}
            {report.declared
              ? t(compliant ? 'pdfa.declaredOk' : 'pdfa.declaredIssues', { part: report.declared.part, conformance: report.declared.conformance.toLowerCase() })
              : t('pdfa.notDeclared')}
          </p>
          {report.issues.filter((issue) => issue.code !== 'not-declared').length > 0 && (
            <ul className={styles.list} data-testid="pdfa-issues">
              {report.issues
                .filter((issue) => issue.code !== 'not-declared')
                .map((issue) => (
                  <li key={issue.code}>{t(`pdfa.issue.${issue.code}`, { detail: issue.detail ?? '', count: issue.count ?? 1 })}</li>
                ))}
            </ul>
          )}
          {tab.signatures && tab.signatures.length > 0 && <p className={styles.muted}>{t('pdfa.signedHint')}</p>}
          <p className={styles.muted}>{t('pdfa.hint')}</p>
        </>
      )}
    </Dialog>
  );
}
