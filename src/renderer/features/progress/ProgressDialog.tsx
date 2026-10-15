import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { cancelProgress, useProgress } from './progress';
import styles from './ProgressDialog.module.css';

// Fortschritt einer längeren Aufgabe mit „Abbrechen“
export function ProgressDialog() {
  const { t } = useTranslation();
  const progress = useProgress((s) => s.progress);
  if (!progress) return null;
  const share = progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  return (
    <Dialog
      title={t(progress.title)}
      onClose={cancelProgress}
      width={420}
      testId="progress-dialog"
      actions={
        <DialogButton onClick={cancelProgress} disabled={progress.cancelling} testId="progress-cancel">
          {t(progress.cancelling ? 'progress.cancelling' : 'progress.cancel')}
        </DialogButton>
      }
    >
      <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
        <div className={styles.bar} style={{ width: `${share * 100}%` }} />
      </div>
      <p className={styles.step} data-testid="progress-step">
        {progress.step ? t(progress.step.key, progress.step.values) : ' '}
      </p>
    </Dialog>
  );
}
