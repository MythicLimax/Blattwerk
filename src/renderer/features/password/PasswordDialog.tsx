import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { closeTab, submitPassword } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import styles from './PasswordDialog.module.css';

export function PasswordDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');

  return (
    <Dialog
      title={t('password.title')}
      onClose={() => void closeTab(tab.id)}
      onSubmit={() => submitPassword(tab.id, password)}
      testId="password-dialog"
      actions={
        <>
          <DialogButton onClick={() => void closeTab(tab.id)}>{t('password.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={password.length === 0}>
            {t('password.ok')}
          </DialogButton>
        </>
      }
    >
      <p className={styles.message}>{t('password.message', { name: tab.name })}</p>
      {tab.passwordIncorrect && (
        <p className={styles.error} role="alert" data-testid="password-incorrect">
          {t('password.incorrect')}
        </p>
      )}
      <label className={styles.field}>
        <span>{t('password.label')}</span>
        <input
          type="password"
          className={styles.input}
          value={password}
          autoFocus
          autoComplete="off"
          onChange={(event) => setPassword(event.target.value)}
          data-testid="password-input"
        />
      </label>
    </Dialog>
  );
}
