import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { OcrLanguage } from '../../engine/ocr-client';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { usePages } from '../stamping/StampDialogs';
import { recognizeText } from './actions';

const close = () => useUi.getState().setOcrOpen(false);
const LANGUAGES: OcrLanguage[] = ['deu', 'eng'];

// Text erkennen: Seiten und Sprachen wählen
export function OcrDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [languages, setLanguages] = useState<OcrLanguage[]>(['deu', 'eng']);
  const { pages, invalid, field } = usePages(tab.pageCount);

  const submit = () => {
    if (invalid || languages.length === 0) return;
    close();
    void recognizeText(tab, { pages, languages });
  };

  const toggle = (language: OcrLanguage, on: boolean) =>
    setLanguages((current) => (on ? LANGUAGES.filter((item) => item === language || current.includes(item)) : current.filter((item) => item !== language)));

  return (
    <Dialog
      title={t('ocr.title')}
      onClose={close}
      onSubmit={submit}
      width={460}
      testId="ocr-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('ocr.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={invalid || languages.length === 0} testId="ocr-confirm">
            {t('ocr.start')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('ocr.message')}</p>
      {field}
      <p className={fieldStyles.hint}>{t('ocr.languages')}</p>
      {LANGUAGES.map((language) => (
        <label key={language} className={pageStyles.check}>
          <input type="checkbox" checked={languages.includes(language)} onChange={(event) => toggle(language, event.target.checked)} data-testid={`ocr-${language}`} />
          {t(`ocr.language.${language}`)}
        </label>
      ))}
      <p className={fieldStyles.hint}>{t('ocr.hint')}</p>
    </Dialog>
  );
}
