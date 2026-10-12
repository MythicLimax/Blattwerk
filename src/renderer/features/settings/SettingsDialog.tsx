import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { Dialog, DialogButton } from '../../components/Dialog';
import { useUi } from '../../state/ui-store';
import styles from '../password/PasswordDialog.module.css';

// Einstellungen: Name, der bei neuen Kommentaren als Verfasser eingetragen wird.
export function SettingsDialog() {
  const { t } = useTranslation();
  const [name, setName] = useState(useUi.getState().authorName);
  const close = () => useUi.getState().setSettingsOpen(false);

  const submit = () => {
    const value = name.trim();
    void api.setAuthorName(value).then((settings) => useUi.getState().setAuthorName(settings.authorName));
    close();
  };

  return (
    <Dialog
      title={t('settings.title')}
      onClose={close}
      onSubmit={submit}
      width={380}
      testId="settings-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('settings.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!name.trim()} testId="settings-save">
            {t('settings.save')}
          </DialogButton>
        </>
      }
    >
      <label className={styles.field}>
        <span>{t('settings.authorName')}</span>
        <input
          className={styles.input}
          value={name}
          maxLength={200}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          data-testid="settings-author"
        />
      </label>
      <p className={styles.hint}>{t('settings.authorHint')}</p>
    </Dialog>
  );
}
