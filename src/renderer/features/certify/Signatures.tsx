import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { summarize, type SignatureCheck } from '../../../shared/signing';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { TabState } from '../../state/documents-store';
import { useCertify } from './certify-store';
import styles from './Certify.module.css';

const ICONS = { valid: ShieldCheck, changed: ShieldAlert, invalid: ShieldX } as const;
const TONE = { valid: styles.valid, changed: styles.warning, invalid: styles.invalid } as const;

// Leiste über einem signierten Dokument: Gesamturteil und „Details“
export function SignaturesBar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const checks = tab.signatures;
  if (!checks || checks.length === 0) return null;
  const summary = summarize(checks);
  if (summary === 'none') return null;
  const Icon = ICONS[summary];
  const signers = [...new Set(checks.map((check) => check.signer ?? t('certify.unknownSigner')))].join(', ');
  return (
    <div className={styles.bar} role="status" data-testid="signatures-bar" data-summary={summary}>
      <Icon size={18} className={TONE[summary]} aria-hidden="true" />
      <span className={styles.barText}>{t(`certify.summary.${summary}`, { signers, count: checks.length })}</span>
      <DialogButton onClick={() => useCertify.getState().setDetailsOpen(true)} testId="signatures-details">
        {t('certify.details')}
      </DialogButton>
    </div>
  );
}

function verdict(check: SignatureCheck): 'valid' | 'changed' | 'invalid' {
  if (check.status !== 'valid') return 'invalid';
  return check.coversDocument ? 'valid' : 'changed';
}

// Alle Signaturen mit Prüfergebnis
export function SignaturesDialog({ tab }: { tab: TabState }) {
  const { t, i18n } = useTranslation();
  const close = () => useCertify.getState().setDetailsOpen(false);
  const checks = tab.signatures ?? [];
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : t('certify.noDate'));
  return (
    <Dialog
      title={t('certify.detailsTitle')}
      onClose={close}
      width={540}
      testId="signatures-dialog"
      actions={<DialogButton onClick={close} primary>{t('certify.close')}</DialogButton>}
    >
      <ul className={styles.list}>
        {checks.map((check) => {
          const result = verdict(check);
          const Icon = ICONS[result];
          return (
            <li key={check.field} className={styles.item} data-testid="signature-item">
              <Icon size={22} className={TONE[result]} aria-hidden="true" />
              <div className={styles.itemText}>
                <p>
                  <strong>{check.signer ?? t('certify.unknownSigner')}</strong>
                  {check.organization ? ` (${check.organization})` : ''}
                </p>
                <p className={styles.itemMeta}>
                  {t('certify.signedAt', { date: date(check.signedAt) })}
                  {check.pageIndex !== null ? ` · ${t('certify.onPage', { page: check.pageIndex + 1 })}` : ` · ${t('certify.invisible')}`}
                </p>
                {(check.reason || check.location) && (
                  <p className={styles.itemMeta}>{[check.reason && t('certify.reasonValue', { value: check.reason }), check.location && t('certify.locationValue', { value: check.location })].filter(Boolean).join(' · ')}</p>
                )}
                <p>{t(check.status === 'valid' ? `certify.verdict.${result}` : `certify.verdict.${check.status}`)}</p>
                {check.certificateValidAtSigning === false && <p className={styles.invalid}>{t('certify.certificateInvalid')}</p>}
                <p className={styles.itemMeta}>{check.selfSigned ? t('certify.selfSigned') : t('certify.issuedBy', { issuer: check.issuer ?? '?' })}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
