import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { cancelPrint } from '../../engine/session';
import type { PrintProgress } from '../../state/ui-store';
import styles from './PrintProgressDialog.module.css';

export function PrintProgressDialog({ progress }: { progress: PrintProgress }) {
  const { t } = useTranslation();
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <Dialog
      title={t('print.preparing')}
      onClose={cancelPrint}
      width={360}
      testId="print-progress"
      actions={<DialogButton onClick={cancelPrint}>{t('print.cancel')}</DialogButton>}
    >
      <progress className={styles.bar} max={100} value={percent} />
      <p className={styles.text}>{t('print.progress', { current: progress.current, total: progress.total })}</p>
    </Dialog>
  );
}
