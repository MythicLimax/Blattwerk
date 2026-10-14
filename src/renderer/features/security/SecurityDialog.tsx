import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_PERMISSIONS, checkSecurityInput, type PrintPermission, type SecurityPermissions } from '../../../shared/security';
import { Dialog, DialogButton } from '../../components/Dialog';
import { readSecurity } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import { applyProtection, checkOwnerPassword } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { hasSignatures } from '../redaction/actions';
import styles from './SecurityDialog.module.css';

const close = () => useUi.getState().setSecurityDialogOpen(false);

const FLAGS = ['copying', 'annotating', 'fillingForms', 'assembling', 'modifying', 'accessibility'] as const;

// Kennwortschutz und Berechtigungen (Phase 6). Wurde das Dokument nur mit dem Kennwort zum Öffnen geöffnet, fragt
// der Dialog zuerst das Berechtigungskennwort ab.
export function SecurityDialog({ tab }: { tab: TabState }) {
  const [ownerPassword, setOwnerPassword] = useState<string | null>(null);
  if (!tab.ownerAccess && ownerPassword === null) return <OwnerPasswordStep tab={tab} onUnlocked={setOwnerPassword} />;
  return <SecuritySettingsStep tab={tab} ownerPassword={ownerPassword} />;
}

function OwnerPasswordStep({ tab, onUnlocked }: { tab: TabState; onUnlocked: (password: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    const ok = await checkOwnerPassword(tab.id, value);
    setBusy(false);
    if (ok) onUnlocked(value);
    else setWrong(true);
  };

  return (
    <Dialog
      title={t('security.title')}
      onClose={close}
      onSubmit={() => void submit()}
      width={440}
      testId="security-owner-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('security.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!value || busy} testId="security-owner-confirm">
            {t('security.unlock')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('security.ownerNeeded')}</p>
      {wrong && (
        <p className={fieldStyles.error} role="alert" data-testid="security-owner-wrong">
          {t('security.ownerWrong')}
        </p>
      )}
      <label className={fieldStyles.field}>
        {t('security.permissionsPassword')}
        <input
          type="password"
          className={fieldStyles.input}
          value={value}
          autoFocus
          onChange={(event) => {
            setValue(event.target.value);
            setWrong(false);
          }}
          data-testid="security-owner-input"
        />
      </label>
    </Dialog>
  );
}

function SecuritySettingsStep({ tab, ownerPassword }: { tab: TabState; ownerPassword: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openPassword, setOpenPassword] = useState('');
  const [openRepeat, setOpenRepeat] = useState('');
  const [restrict, setRestrict] = useState(false);
  const [permissionsPassword, setPermissionsPassword] = useState('');
  const [permissionsRepeat, setPermissionsRepeat] = useState('');
  const [permissions, setPermissions] = useState<SecurityPermissions>({ ...ALL_PERMISSIONS, modifying: false });
  const [signed, setSigned] = useState(false);
  const [touched, setTouched] = useState(false);

  // Vorhandene Einschränkungen als Vorschlag übernehmen
  useEffect(() => {
    let cancelled = false;
    void hasSignatures(tab.id).then((result) => {
      if (!cancelled) setSigned(result);
    });
    const runtime = getRuntime(tab.id);
    if (tab.encrypted && runtime?.pdf) {
      void runtime.pdf
        .getData()
        .then((bytes) => readSecurity(bytes, ownerPassword ?? runtime.password))
        .then((security) => {
          if (cancelled) return;
          const restricted = Object.entries(ALL_PERMISSIONS).some(([key, value]) => security.permissions[key as keyof SecurityPermissions] !== value);
          if (restricted) setPermissions(security.permissions);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [tab.id, tab.encrypted, ownerPassword]);

  const problem = checkSecurityInput({ open, openPassword, openRepeat, restrict, permissionsPassword, permissionsRepeat });
  const nothing = !open && !restrict;

  const submit = () => {
    setTouched(true);
    if (problem || nothing) return;
    close();
    void applyProtection(
      tab.id,
      { openPassword: open ? openPassword : null, permissionsPassword: restrict ? permissionsPassword : null, permissions },
      ownerPassword,
    );
  };

  const remove = () => {
    close();
    void applyProtection(tab.id, null, ownerPassword);
  };

  const setFlag = (key: (typeof FLAGS)[number], value: boolean) => setPermissions((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      title={t('security.title')}
      onClose={close}
      onSubmit={submit}
      width={500}
      testId="security-dialog"
      actions={
        <>
          {tab.encrypted && (
            <DialogButton onClick={remove} testId="security-remove">
              {t('security.remove')}
            </DialogButton>
          )}
          <DialogButton onClick={close}>{t('security.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={nothing} testId="security-apply">
            {t('security.apply')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t(tab.encrypted ? 'security.statusProtected' : 'security.statusOpen')}</p>
      {signed && (
        <p className={fieldStyles.error} role="alert">
          {t('security.signedWarning')}
        </p>
      )}
      <fieldset className={styles.group}>
        <label className={pageStyles.check}>
          <input type="checkbox" checked={open} onChange={(event) => setOpen(event.target.checked)} data-testid="security-open" />
          {t('security.requireOpen')}
        </label>
        {open && (
          <div className={styles.passwords}>
            <PasswordField label={t('security.openPassword')} value={openPassword} onChange={setOpenPassword} testId="security-open-password" />
            <PasswordField label={t('security.repeat')} value={openRepeat} onChange={setOpenRepeat} testId="security-open-repeat" />
          </div>
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <label className={pageStyles.check}>
          <input type="checkbox" checked={restrict} onChange={(event) => setRestrict(event.target.checked)} data-testid="security-restrict" />
          {t('security.restrict')}
        </label>
        {restrict && (
          <>
            <div className={styles.passwords}>
              <PasswordField
                label={t('security.permissionsPassword')}
                value={permissionsPassword}
                onChange={setPermissionsPassword}
                testId="security-permissions-password"
              />
              <PasswordField label={t('security.repeat')} value={permissionsRepeat} onChange={setPermissionsRepeat} testId="security-permissions-repeat" />
            </div>
            <label className={styles.row}>
              {t('security.printing')}
              <select
                className={pageStyles.select}
                value={permissions.printing}
                onChange={(event) => setPermissions((current) => ({ ...current, printing: event.target.value as PrintPermission }))}
                data-testid="security-printing"
              >
                {(['high', 'low', 'none'] as const).map((value) => (
                  <option key={value} value={value}>
                    {t(`security.print.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {FLAGS.map((key) => (
              <label key={key} className={pageStyles.check}>
                <input type="checkbox" checked={permissions[key]} onChange={(event) => setFlag(key, event.target.checked)} data-testid={`security-${key}`} />
                {t(`security.flags.${key}`)}
              </label>
            ))}
            <p className={fieldStyles.hint}>{t('security.restrictHint')}</p>
          </>
        )}
      </fieldset>
      {touched && problem && (
        <p className={fieldStyles.error} role="alert" data-testid="security-problem">
          {t(`security.problems.${problem}`)}
        </p>
      )}
      <p className={fieldStyles.hint}>{t('security.rewriteHint')}</p>
    </Dialog>
  );
}

function PasswordField({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  return (
    <label className={fieldStyles.field}>
      {label}
      <input type="password" className={fieldStyles.input} value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} />
    </label>
  );
}
