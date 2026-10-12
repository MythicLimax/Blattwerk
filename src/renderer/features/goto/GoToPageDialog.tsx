import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { goToPage } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import styles from '../password/PasswordDialog.module.css';
import { parsePageNumber } from './page-number';

export function GoToPageDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(tab.currentPage));
  const [invalid, setInvalid] = useState(false);
  const close = () => useUi.getState().setGoToPageOpen(false);

  const submit = () => {
    const page = parsePageNumber(value, tab.pageCount);
    if (page === null) {
      setInvalid(true);
      return;
    }
    goToPage(tab, page);
    close();
  };

  return (
    <Dialog
      title={t('goto.title')}
      onClose={close}
      onSubmit={submit}
      width={320}
      testId="goto-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('goto.cancel')}</DialogButton>
          <DialogButton type="submit" primary>
            {t('goto.ok')}
          </DialogButton>
        </>
      }
    >
      <label className={styles.field}>
        <span>{t('goto.label', { count: tab.pageCount })}</span>
        <input
          className={styles.input}
          inputMode="numeric"
          value={value}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          data-testid="goto-input"
        />
      </label>
      {invalid && (
        <p className={styles.error} role="alert">
          {t('goto.invalid', { count: tab.pageCount })}
        </p>
      )}
    </Dialog>
  );
}
