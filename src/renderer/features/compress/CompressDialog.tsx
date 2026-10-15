import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompressionLevel } from '../../../shared/compress';
import { Dialog, DialogButton } from '../../components/Dialog';
import { applyCompression } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { hasSignatures } from '../redaction/actions';

const close = () => useUi.getState().setCompressOpen(false);
const LEVELS: CompressionLevel[] = ['light', 'medium', 'strong'];

// PDF verkleinern: Stufe wählen (Phase 6)
export function CompressDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<CompressionLevel>('medium');
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void hasSignatures(tab.id).then((result) => {
      if (!cancelled) setSigned(result);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.id]);

  const submit = () => {
    close();
    void applyCompression(tab.id, level);
  };

  return (
    <Dialog
      title={t('compress.title')}
      onClose={close}
      onSubmit={submit}
      width={460}
      testId="compress-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('compress.cancel')}</DialogButton>
          <DialogButton type="submit" primary autoFocus testId="compress-confirm">
            {t('compress.apply')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('compress.message')}</p>
      {signed && (
        <p className={fieldStyles.error} role="alert">
          {t('compress.signedWarning')}
        </p>
      )}
      {LEVELS.map((value) => (
        <label key={value} className={pageStyles.check}>
          <input type="radio" name="compress-level" checked={level === value} onChange={() => setLevel(value)} data-testid={`compress-${value}`} />
          {t(`compress.levels.${value}`)}
        </label>
      ))}
      <p className={fieldStyles.hint}>{t('compress.hint')}</p>
    </Dialog>
  );
}
