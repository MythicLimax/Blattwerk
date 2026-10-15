import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SignRequestInput } from '../../../shared/signing';
import { api } from '../../api';
import { Dialog, DialogButton } from '../../components/Dialog';
import { createIdentity } from '../../engine/pdfium-client';
import { applyDigitalSignature } from '../../engine/session';
import { t as translate } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { useCertify } from './certify-store';
import styles from './Certify.module.css';

const store = useCertify.getState;

// Texte im sichtbaren Unterschriftsfeld
export const appearanceLabels = (): SignRequestInput['labels'] => ({
  signedBy: translate('certify.appearance.signedBy'),
  date: translate('certify.appearance.date'),
  reason: translate('certify.appearance.reason'),
});

const idError = (error: 'cancelled' | 'unreadable' | 'invalid') => (error === 'cancelled' ? null : translate(`certify.idErrors.${error}`));

// Mit Zertifikat unterschreiben: digitale ID, Kennwort, Grund, Ort, sichtbar oder unsichtbar
export function CertifyDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const id = useCertify((s) => s.id);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [visible, setVisible] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => store().setDialogOpen(false);

  // Zuletzt verwendete ID vorschlagen
  useEffect(() => {
    if (store().id) return;
    void api.digitalId.last().then((result) => {
      if (result.ok && !store().id) store().setId({ name: result.name, bytes: result.bytes });
    });
  }, []);

  const pick = async () => {
    const result = await api.digitalId.pick();
    if (result.ok) {
      store().setId({ name: result.name, bytes: result.bytes });
      setProblem(null);
    } else setProblem(idError(result.error));
  };

  const submit = () => {
    if (!id) {
      setProblem(t('certify.noId'));
      return;
    }
    const request: Omit<SignRequestInput, 'placement'> = {
      p12: id.bytes.slice().buffer as ArrayBuffer,
      password,
      reason: reason.trim() || null,
      location: location.trim() || null,
      labels: appearanceLabels(),
    };
    close();
    if (visible) store().setPlacement({ tabId: tab.id, request });
    else void applyDigitalSignature(tab.id, { ...request, placement: null });
  };

  return (
    <Dialog
      title={t('certify.title')}
      onClose={close}
      onSubmit={submit}
      width={480}
      testId="certify-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('certify.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!id} testId="certify-confirm">
            {visible ? t('certify.placeField') : t('certify.sign')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('certify.message')}</p>
      <div className={styles.idRow}>
        <span className={styles.idName} data-testid="certify-id">
          {id ? id.name : t('certify.noIdYet')}
        </span>
        <DialogButton onClick={() => void pick()} testId="certify-pick">
          {t('certify.pickId')}
        </DialogButton>
        <DialogButton onClick={() => store().setCreateOpen(true)} testId="certify-create">
          {t('certify.createId')}
        </DialogButton>
      </div>
      <label className={fieldStyles.field}>
        {t('certify.password')}
        <input type="password" className={fieldStyles.input} value={password} onChange={(event) => setPassword(event.target.value)} data-testid="certify-password" />
      </label>
      <div className={styles.twoColumns}>
        <label className={fieldStyles.field}>
          {t('certify.reason')}
          <input className={fieldStyles.input} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('certify.reasonPlaceholder')} data-testid="certify-reason" />
        </label>
        <label className={fieldStyles.field}>
          {t('certify.location')}
          <input className={fieldStyles.input} value={location} onChange={(event) => setLocation(event.target.value)} data-testid="certify-location" />
        </label>
      </div>
      <label className={pageStyles.check}>
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} data-testid="certify-visible" />
        {t('certify.visible')}
      </label>
      {problem && (
        <p className={fieldStyles.error} role="alert">
          {problem}
        </p>
      )}
      <p className={fieldStyles.hint}>{t('certify.hint')}</p>
    </Dialog>
  );
}

// Eigene digitale ID erstellen und als .p12 speichern
export function CreateIdDialog() {
  const { t } = useTranslation();
  const authorName = useUi((s) => s.authorName);
  const [name, setName] = useState(authorName);
  const [organization, setOrganization] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => store().setCreateOpen(false);

  const submit = async () => {
    if (!name.trim()) return setProblem(t('certify.create.noName'));
    if (password.length < 6) return setProblem(t('certify.create.short'));
    if (password !== repeat) return setProblem(t('certify.create.mismatch'));
    setBusy(true);
    try {
      const bytes = await createIdentity({ name: name.trim(), organization: organization.trim() || null, email: email.trim() || null, password, years: 5 });
      const saved = await api.digitalId.save(bytes, name.trim());
      if (!saved.ok) {
        if (saved.error !== 'cancelled') setProblem(t('certify.create.saveFailed'));
        return;
      }
      store().setId({ name: saved.name, bytes });
      useUi.getState().confirm(t('certify.create.done', { name: saved.name }));
      close();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('certify.create.title')}
      onClose={close}
      onSubmit={() => void submit()}
      width={460}
      testId="create-id-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('certify.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={busy} testId="create-id-confirm">
            {t('certify.create.save')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('certify.create.message')}</p>
      <label className={fieldStyles.field}>
        {t('certify.create.name')}
        <input className={fieldStyles.input} value={name} onChange={(event) => setName(event.target.value)} data-testid="create-id-name" />
      </label>
      <div className={styles.twoColumns}>
        <label className={fieldStyles.field}>
          {t('certify.create.organization')}
          <input className={fieldStyles.input} value={organization} onChange={(event) => setOrganization(event.target.value)} />
        </label>
        <label className={fieldStyles.field}>
          {t('certify.create.email')}
          <input className={fieldStyles.input} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>
      <div className={styles.twoColumns}>
        <label className={fieldStyles.field}>
          {t('certify.password')}
          <input type="password" className={fieldStyles.input} value={password} onChange={(event) => setPassword(event.target.value)} data-testid="create-id-password" />
        </label>
        <label className={fieldStyles.field}>
          {t('certify.create.repeat')}
          <input type="password" className={fieldStyles.input} value={repeat} onChange={(event) => setRepeat(event.target.value)} data-testid="create-id-repeat" />
        </label>
      </div>
      {problem && (
        <p className={fieldStyles.error} role="alert" data-testid="create-id-problem">
          {problem}
        </p>
      )}
      <p className={fieldStyles.hint}>{t('certify.create.hint')}</p>
    </Dialog>
  );
}
