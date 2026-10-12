import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { Prompt } from '../../state/ui-store';

// Rückfragen beim Schließen mit ungespeicherten Änderungen und bei einer von außen geänderten Datei.
export function PromptDialog({ prompt }: { prompt: Prompt }) {
  const { t } = useTranslation();
  const answer = prompt.resolve;
  if (prompt.kind === 'unsaved') {
    return (
      <Dialog
        title={t('prompt.unsaved.title')}
        onClose={() => answer('cancel')}
        width={440}
        testId="prompt-unsaved"
        actions={
          <>
            <DialogButton onClick={() => answer('discard')} testId="prompt-discard">
              {t('prompt.unsaved.discard')}
            </DialogButton>
            <DialogButton onClick={() => answer('cancel')} testId="prompt-cancel">
              {t('prompt.cancel')}
            </DialogButton>
            <DialogButton primary autoFocus onClick={() => answer('save')} testId="prompt-save">
              {t('prompt.unsaved.save')}
            </DialogButton>
          </>
        }
      >
        <p>{t('prompt.unsaved.message', { name: prompt.name })}</p>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={t('prompt.changed.title')}
      onClose={() => answer('cancel')}
      width={460}
      testId="prompt-changed"
      actions={
        <>
          <DialogButton onClick={() => answer('overwrite')} testId="prompt-overwrite">
            {t('prompt.changed.overwrite')}
          </DialogButton>
          <DialogButton onClick={() => answer('cancel')} testId="prompt-cancel">
            {t('prompt.cancel')}
          </DialogButton>
          <DialogButton primary autoFocus onClick={() => answer('saveAs')} testId="prompt-save-as">
            {t('prompt.changed.saveAs')}
          </DialogButton>
        </>
      }
    >
      <p>{t('prompt.changed.message', { name: prompt.name })}</p>
    </Dialog>
  );
}
