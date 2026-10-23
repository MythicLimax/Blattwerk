import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CLEAN_OPTIONS, type CleanFindings, type CleanOptions } from '../../../shared/clean';
import { Dialog, DialogButton } from '../../components/Dialog';
import { applyCleaning, cleanableOf } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { hasSignatures } from '../redaction/actions';

const close = () => useUi.getState().setCleanOpen(false);

// Dokument bereinigen: nur anbieten, was das Dokument enthält; alles Vorhandene ist vorgewählt
export function CleanDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [findings, setFindings] = useState<CleanFindings | null>(null);
  const [chosen, setChosen] = useState<CleanOptions>({ metadata: true, attachments: true, scripts: true, bookmarks: false });
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void cleanableOf(tab.id).then((result) => {
      if (cancelled || !result) return;
      setFindings(result);
      // Lesezeichen helfen beim Lesen: nur auf Wunsch entfernen
      setChosen({ metadata: result.metadata, attachments: result.attachments, scripts: result.scripts, bookmarks: false });
    });
    void hasSignatures(tab.id).then((result) => {
      if (!cancelled) setSigned(result);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.id]);

  const options: CleanOptions = findings
    ? { metadata: chosen.metadata && findings.metadata, attachments: chosen.attachments && findings.attachments, scripts: chosen.scripts && findings.scripts, bookmarks: chosen.bookmarks && findings.bookmarks }
    : chosen;
  const anything = findings !== null && CLEAN_OPTIONS.some((key) => findings[key]);
  const selected = CLEAN_OPTIONS.some((key) => options[key]);

  const submit = () => {
    if (!findings || !selected) return;
    close();
    void applyCleaning(tab.id, options);
  };

  return (
    <Dialog
      title={t('clean.title')}
      onClose={close}
      onSubmit={submit}
      width={460}
      testId="clean-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('clean.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!selected || !findings} testId="clean-confirm">
            {t('clean.apply')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('clean.message')}</p>
      {signed && (
        <p className={fieldStyles.error} role="alert">
          {t('clean.signedWarning')}
        </p>
      )}
      {!findings && <p className={fieldStyles.hint}>{t('clean.checking')}</p>}
      {findings && !anything && <p className={fieldStyles.hint} data-testid="clean-nothing">{t('clean.nothing')}</p>}
      {findings &&
        anything &&
        CLEAN_OPTIONS.map((key) => (
          <label key={key} className={pageStyles.check}>
            <input
              type="checkbox"
              checked={options[key]}
              disabled={!findings[key]}
              onChange={(event) => setChosen({ ...chosen, [key]: event.target.checked })}
              data-testid={`clean-${key}`}
            />
            {t(`clean.options.${key}`)}
            {!findings[key] && <span className={fieldStyles.hint}> ({t('clean.absent')})</span>}
          </label>
        ))}
      <p className={fieldStyles.hint}>{t('clean.hint')}</p>
    </Dialog>
  );
}
