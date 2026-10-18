import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { busy, currentBytes } from '../pages/actions';
import styles from '../password/PasswordDialog.module.css';

// „Als Vorlage sichern“ (ADR 0028): der aktuelle Stand des Dokuments (mit ungespeicherten Änderungen) als eigene Vorlage
export function SaveTemplateDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [name, setName] = useState(tab.name.replace(/\.pdf$/i, ''));
  const [saving, setSaving] = useState(false);
  const close = () => useUi.getState().setTemplateDialogTab(null);

  const submit = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    const ui = useUi.getState();
    try {
      const result = await busy('templateDialog.title', async () => api.templates.save((await currentBytes(tab)).bytes, name.trim()));
      if (result.ok) ui.confirm(t('templateDialog.saved', { name: result.template.name }));
      else ui.notify(result.error === 'too-many' ? t('templateDialog.tooMany') : t('templateDialog.failed'));
    } catch (error) {
      ui.notify(t('templateDialog.failed'), error instanceof Error ? error.message : String(error));
    }
    close();
  };

  return (
    <Dialog
      title={t('templateDialog.title')}
      onClose={close}
      onSubmit={() => void submit()}
      width={380}
      testId="template-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('templateDialog.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={saving || !name.trim()}>
            {t('templateDialog.save')}
          </DialogButton>
        </>
      }
    >
      <p>{t('templateDialog.message')}</p>
      <label className={styles.field}>
        <span>{t('templateDialog.name')}</span>
        <input
          className={styles.input}
          value={name}
          maxLength={120}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.target.value)}
          data-testid="template-name"
        />
      </label>
    </Dialog>
  );
}
