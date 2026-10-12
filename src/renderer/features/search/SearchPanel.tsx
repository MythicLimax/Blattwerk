import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import {
  closeFind,
  dispatchFind,
  getRuntime,
  matchPosition,
  originalPageText,
  type DocumentRuntime,
  type FindType,
} from '../../engine/runtime';
import { goToPage } from '../../engine/session';
import { useDocuments, type SearchState, type TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import styles from './SearchPanel.module.css';
import { snippetAround, type Snippet } from './snippet';

// Höchstzahl an Ergebniszeilen in der Liste. Die Zählung oben bleibt vollständig.
const MAX_RESULT_ROWS = 500;

function statusText(t: (key: string, options?: Record<string, unknown>) => string, search: SearchState): string {
  if (!search.query) return t('search.hint');
  switch (search.status) {
    case 'pending':
      return search.total > 0 ? t('search.count', { current: search.current, count: search.total }) : t('search.pending');
    case 'not-found':
      return t('search.notFound');
    case 'wrapped-top':
      return t('search.wrappedTop');
    case 'wrapped-bottom':
      return t('search.wrappedBottom');
    case 'found':
      return t('search.count', { current: search.current, count: search.total });
    default:
      return '';
  }
}

function ResultRow({
  runtime,
  tab,
  pageIndex,
  matchIndex,
}: {
  runtime: DocumentRuntime;
  tab: TabState;
  pageIndex: number;
  matchIndex: number;
}) {
  const { t } = useTranslation();
  const [snippet, setSnippet] = useState<Snippet | null>(null);

  useEffect(() => {
    let cancelled = false;
    const position = matchPosition(runtime, pageIndex, matchIndex);
    if (!position) return;
    void originalPageText(runtime, pageIndex).then((text) => {
      if (!cancelled) setSnippet(snippetAround(text, position.start, position.length));
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, pageIndex, matchIndex]);

  return (
    <li>
      <button type="button" className={styles.result} onClick={() => goToPage(tab, pageIndex + 1)}>
        <span className={styles.resultPage}>{t('search.page', { page: pageIndex + 1 })}</span>
        {snippet && (
          <span className={styles.snippet}>
            {snippet.before}
            <mark className={styles.mark}>{snippet.match}</mark>
            {snippet.after}
          </span>
        )}
      </button>
    </li>
  );
}

export function SearchPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const focusRequest = useUi((s) => s.searchFocusRequest);
  const updateSearch = useDocuments((s) => s.updateSearch);
  const [draft, setDraft] = useState(tab.search.query);
  const search = tab.search;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // Beim Schließen des Bereichs die Markierungen im Dokument entfernen.
  useEffect(() => {
    return () => {
      const runtime = getRuntime(tab.id);
      if (runtime) closeFind(runtime);
    };
  }, [tab.id]);

  const run = (next: SearchState, type: FindType, previous = false) => {
    const runtime = getRuntime(tab.id);
    if (runtime && next.query) dispatchFind(runtime, next, type, previous);
  };

  const onChangeQuery = (value: string) => {
    setDraft(value);
    const next = { ...search, query: value, status: value ? search.status : ('idle' as const), current: 0, total: value ? search.total : 0, pages: value ? search.pages : [] };
    updateSearch(tab.id, next);
    if (value) run(next, '');
    else {
      const runtime = getRuntime(tab.id);
      if (runtime) closeFind(runtime);
    }
  };

  const onToggle = (key: 'caseSensitive' | 'entireWord' | 'matchDiacritics', type: FindType) => {
    const next = { ...search, [key]: !search[key] };
    updateSearch(tab.id, { [key]: next[key] });
    run(next, type);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run(search, 'again', event.shiftKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      useUi.getState().setRightPanelVisible(false);
    }
  };

  const rows = useMemo(() => {
    const result: Array<{ pageIndex: number; matchIndex: number }> = [];
    for (const page of search.pages) {
      for (let i = 0; i < page.count && result.length < MAX_RESULT_ROWS; i++) {
        result.push({ pageIndex: page.pageIndex, matchIndex: i });
      }
      if (result.length >= MAX_RESULT_ROWS) break;
    }
    return result;
  }, [search.pages]);

  const runtime = getRuntime(tab.id);

  return (
    <div className={styles.panel} data-testid="search-panel">
      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          type="search"
          className={styles.input}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          value={draft}
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid="search-input"
        />
        <IconButton
          icon={ChevronUp}
          label={t('search.previous')}
          disabled={!search.query || search.total === 0}
          onClick={() => run(search, 'again', true)}
        />
        <IconButton
          icon={ChevronDown}
          label={t('search.next')}
          disabled={!search.query || search.total === 0}
          onClick={() => run(search, 'again', false)}
          data-testid="search-next"
        />
      </div>

      <div className={styles.options}>
        <label className={styles.option}>
          <input type="checkbox" checked={search.caseSensitive} onChange={() => onToggle('caseSensitive', 'casesensitivitychange')} />
          {t('search.caseSensitive')}
        </label>
        <label className={styles.option}>
          <input type="checkbox" checked={search.entireWord} onChange={() => onToggle('entireWord', 'entirewordchange')} />
          {t('search.entireWord')}
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={search.matchDiacritics}
            onChange={() => onToggle('matchDiacritics', 'diacriticmatchingchange')}
          />
          {t('search.diacritics')}
        </label>
      </div>

      <div className={styles.status} aria-live="polite" data-testid="search-status">
        {statusText(t, search)}
      </div>

      {rows.length > 0 && runtime && (
        <ol className={styles.results} aria-label={t('search.results')} data-testid="search-results">
          {rows.map(({ pageIndex, matchIndex }) => (
            <ResultRow
              key={`${pageIndex}:${matchIndex}`}
              runtime={runtime}
              tab={tab}
              pageIndex={pageIndex}
              matchIndex={matchIndex}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
