import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextMatch } from '../../../shared/redaction';
import { Dialog, DialogButton } from '../../components/Dialog';
import { applyRedactionMarks } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { findForRedaction, hasSignatures, markMatches, redactionMarkCount } from './actions';

const close = () => useUi.getState().setRedactDialog(null);

// Rückfrage vor dem endgültigen Schwärzen
export function RedactApplyDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [removeMetadata, setRemoveMetadata] = useState(true);
  const [signed, setSigned] = useState(false);
  const count = redactionMarkCount(tab.id);

  useEffect(() => {
    let cancelled = false;
    void hasSignatures(tab.id).then((result) => {
      if (!cancelled) setSigned(result);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.id]);

  const submit = () => {
    close();
    void applyRedactionMarks(tab.id, { removeMetadata });
  };

  return (
    <Dialog
      title={t('redaction.applyTitle')}
      onClose={close}
      onSubmit={submit}
      width={460}
      testId="redact-apply-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('redaction.cancel')}</DialogButton>
          <DialogButton type="submit" primary autoFocus testId="redact-apply-confirm">
            {t('redaction.applyConfirm')}
          </DialogButton>
        </>
      }
    >
      <p className={fieldStyles.message}>{t('redaction.applyMessage', { count })}</p>
      <p className={fieldStyles.hint}>{t('redaction.applyRewrite')}</p>
      {signed && (
        <p className={fieldStyles.error} role="alert" data-testid="redact-signed-warning">
          {t('redaction.signedWarning')}
        </p>
      )}
      <label className={pageStyles.check}>
        <input type="checkbox" checked={removeMetadata} onChange={(event) => setRemoveMetadata(event.target.checked)} data-testid="redact-metadata" />
        {t('redaction.removeMetadata')}
      </label>
    </Dialog>
  );
}

// Text suchen und alle Treffer zum Schwärzen markieren (z. B. Namen, Kontonummern)
export function RedactFindDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<{ key: string; matches: TextMatch[]; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Ein Ergebnis gilt nur für genau diese Suche (Text und Optionen)
  const key = JSON.stringify([query.trim(), matchCase, wholeWord]);
  const current = result && result.key === key ? result : null;
  const pages = current ? new Set(current.matches.map((match) => match.pageIndex)).size : 0;

  const search = async () => {
    const value = query.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const found = await findForRedaction(tab.id, { query: value, matchCase, wholeWord });
      setResult({ key, ...found });
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (current && current.matches.length > 0) {
      markMatches(tab.id, current.matches);
      close();
    } else {
      void search();
    }
  };

  return (
    <Dialog
      title={t('redaction.findTitle')}
      onClose={close}
      onSubmit={submit}
      width={440}
      testId="redact-find-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('redaction.cancel')}</DialogButton>
          <DialogButton onClick={() => void search()} disabled={!query.trim() || busy} testId="redact-find-search">
            {t('redaction.search')}
          </DialogButton>
          <DialogButton type="submit" primary disabled={!current || current.matches.length === 0} testId="redact-find-mark">
            {t('redaction.markAll')}
          </DialogButton>
        </>
      }
    >
      <label className={fieldStyles.field}>
        <span>{t('redaction.query')}</span>
        <input
          className={fieldStyles.input}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          data-testid="redact-find-query"
        />
      </label>
      <label className={pageStyles.check}>
        <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
        {t('redaction.matchCase')}
      </label>
      <label className={pageStyles.check}>
        <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
        {t('redaction.wholeWord')}
      </label>
      {current && (
        <p className={fieldStyles.hint} role="status" data-testid="redact-find-result">
          {current.matches.length === 0
            ? t('redaction.noMatches')
            : t(current.truncated ? 'redaction.matchesTruncated' : 'redaction.matches', { count: current.matches.length, pages })}
        </p>
      )}
    </Dialog>
  );
}
