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
  selectMatch,
  type DocumentRuntime,
  type FindType,
} from '../../engine/runtime';
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
  search,
  pageIndex,
  matchIndex,
  start,
  length,
}: {
  runtime: DocumentRuntime;
  search: SearchState;
  pageIndex: number;
  matchIndex: number;
  start: number;
  length: number;
}) {
  const { t } = useTranslation();
  const [snippet, setSnippet] = useState<Snippet | null>(null);

  // Hängt an Position und Länge: Nach einer neuen Suche lädt die Zeile ihren Ausschnitt neu.
  useEffect(() => {
    let cancelled = false;
    void originalPageText(runtime, pageIndex).then((text) => {
      if (!cancelled) setSnippet(snippetAround(text, start, length));
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, pageIndex, start, length]);

  return (
    <li>
      <button type="button" className={styles.result} onClick={() => selectMatch(runtime, search, pageIndex, matchIndex)}>
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

  // Fokus nur bei ausdrücklicher Anforderung (Cmd+F, Suchen-Schaltfläche), nicht bei jedem Tab-Wechsel.
  useEffect(() => {
    const ui = useUi.getState();
    if (focusRequest <= ui.searchFocusHandled) return;
    ui.markSearchFocusHandled(focusRequest);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  // Beim Einblenden vorhandene Treffer wieder markieren, beim Ausblenden die Markierungen entfernen.
  useEffect(() => {
    const runtime = getRuntime(tab.id);
    const current = useDocuments.getState().tabs.find((t) => t.id === tab.id)?.search;
    if (runtime && current?.query) dispatchFind(runtime, current, 'highlightallchange');
    return () => {
      const rt = getRuntime(tab.id);
      if (rt) closeFind(rt);
    };
  }, [tab.id]);

  const run = (next: SearchState, type: FindType, previous = false) => {
    const runtime = getRuntime(tab.id);
    if (runtime && next.query) dispatchFind(runtime, next, type, previous);
  };

  const onChangeQuery = (value: string) => {
    setDraft(value);
    // Alte Ergebnisse sofort verwerfen, damit keine veralteten Zeilen zu sehen sind.
    const next: SearchState = { ...search, query: value, status: value ? 'pending' : 'idle', current: 0, total: 0, pages: [] };
    updateSearch(tab.id, next);
    if (value) run(next, '');
    else {
      const runtime = getRuntime(tab.id);
      if (runtime) closeFind(runtime);
    }
  };

  const onToggle = (key: 'caseSensitive' | 'entireWord' | 'matchDiacritics', type: FindType) => {
    const next: SearchState = { ...search, [key]: !search[key], current: 0, total: 0, pages: [] };
    updateSearch(tab.id, { [key]: next[key], current: 0, total: 0, pages: [] });
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
          {rows.map(({ pageIndex, matchIndex }) => {
            const position = matchPosition(runtime, pageIndex, matchIndex);
            if (!position) return null;
            return (
              <ResultRow
                key={`${pageIndex}:${matchIndex}`}
                runtime={runtime}
                search={search}
                pageIndex={pageIndex}
                matchIndex={matchIndex}
                start={position.start}
                length={position.length}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}
