import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Circle,
  EyeOff,
  FileDown,
  Highlighter,
  Minus,
  MoveUpRight,
  PenLine,
  Square,
  Signature,
  Stamp,
  StickyNote,
  Strikethrough,
  Trash,
  Type,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Annotation, AnnotationKind, ReviewStatus } from '../../../shared/annotations';
import { currentStatus, parsePdfDate, REVIEW_STATUSES, stampColor } from '../../../shared/annotations';
import { IconButton } from '../../components/IconButton';
import { getRuntime } from '../../engine/runtime';
import { useAnnotations, useTabAnnotations } from '../../state/annotations-store';
import type { TabState } from '../../state/documents-store';
import { css } from './AnnotationShape';
import { addReply, deleteAnnotation, deleteReply, editReply, setContents, setStatus } from './controller';
import { authorsOf, commentSummary, filterKey, KIND_GROUPS, matches, parseFilterKey, sortComments, type CommentFilter, type CommentSort, type KindGroup } from './comment-list';
import { api } from '../../api';
import { useUi } from '../../state/ui-store';
import styles from './CommentsPanel.module.css';

const KIND_ICONS: Record<AnnotationKind, LucideIcon> = {
  highlight: Highlighter,
  underline: Underline,
  strikeout: Strikethrough,
  squiggly: Underline,
  note: StickyNote,
  freetext: Type,
  ink: PenLine,
  square: Square,
  circle: Circle,
  line: Minus,
  arrow: MoveUpRight,
  stamp: Stamp,
  signature: Signature,
  redact: EyeOff,
};

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });

function formatDate(value: string): string {
  const date = parsePdfDate(value);
  return date ? dateFormat.format(date) : '';
}

interface PageRow {
  type: 'page';
  pageIndex: number;
  count: number;
}

// Sehr dunkle Farben (z. B. schwarzer Text) wären im Dunkelmodus unsichtbar: dann die Textfarbe nehmen.
function iconColor(a: Annotation): string {
  const color = a.kind === 'stamp' && a.label ? stampColor(a) : a.color;
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return luminance < 0.2 ? 'var(--color-text)' : css(color);
}

type Row = PageRow | { type: 'comment'; annotation: Annotation };

// Springt zur Stelle des Kommentars im Dokument.
export function revealAnnotation(tabId: string, a: Annotation): void {
  const viewer = getRuntime(tabId)?.viewer;
  if (!viewer) return;
  const [left, , , top] = a.rect;
  viewer.scrollPageIntoView({
    pageNumber: a.pageIndex + 1,
    destArray: [null, { name: 'XYZ' }, Math.max(0, left - 20), top + 30, null],
    allowNegativeOffset: false,
  });
}

// Mehrzeiliges Textfeld, das beim Verlassen speichert. Esc verwirft, Cmd/Strg+Enter übernimmt.
function EditableText({
  value,
  label,
  placeholder,
  autoFocus,
  onCommit,
  onDone,
  testId,
}: {
  value: string;
  label: string;
  placeholder: string;
  autoFocus: boolean;
  onCommit: (text: string) => void;
  onDone?: () => void;
  testId: string;
}) {
  // null = unverändert, angezeigt wird der gespeicherte Text
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const skip = useRef(false);
  const shown = draft ?? value;

  // Verschwindet das Feld während der Eingabe (Seitenleiste zu, Ansicht gewechselt), wird der Text trotzdem übernommen.
  const latest = useRef({ draft, value, onCommit });
  useEffect(() => {
    latest.current = { draft, value, onCommit };
  });
  useEffect(
    () => () => {
      const { draft: pending, value: saved, onCommit: commit } = latest.current;
      if (!skip.current && pending !== null && pending !== saved) commit(pending);
    },
    [],
  );

  useEffect(() => {
    if (!autoFocus) return;
    const area = ref.current;
    area?.focus({ preventScroll: true });
    area?.setSelectionRange(area.value.length, area.value.length);
  }, [autoFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      skip.current = true;
      setDraft(null);
      ref.current?.blur();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      ref.current?.blur();
    }
  };

  return (
    <textarea
      ref={ref}
      className={styles.textarea}
      value={shown}
      rows={Math.min(8, Math.max(2, shown.split('\n').length))}
      aria-label={label}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!skip.current && draft !== null && draft !== value) onCommit(draft);
        skip.current = false;
        setDraft(null);
        onDone?.();
      }}
      data-testid={testId}
    />
  );
}

const CommentCard = memo(function CommentCard({
  tabId,
  annotation: a,
  selected,
  editing,
  readOnly,
}: {
  tabId: string;
  annotation: Annotation;
  selected: boolean;
  editing: boolean;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [reply, setReply] = useState('');
  const Icon = KIND_ICONS[a.kind];
  const status = currentStatus(a);

  const select = () => {
    if (selected) return;
    useAnnotations.getState().select(tabId, a.id);
    revealAnnotation(tabId, a);
  };

  const submitReply = () => {
    if (!reply.trim()) return;
    addReply(tabId, a.id, reply);
    setReply('');
  };

  // Freitext zeigt seinen Inhalt auf der Seite und wird dort bearbeitet; Stempel tragen keinen eigenen Text.
  const text = a.kind === 'freetext' || a.kind === 'stamp' || a.kind === 'signature' ? '' : a.contents;

  return (
    <article
      className={[styles.card, selected ? styles.selected : ''].join(' ')}
      onClick={select}
      data-testid="comment-card"
      data-annotation-id={a.id}
      aria-current={selected ? 'true' : undefined}
    >
      <header className={styles.cardHeader}>
        <span className={styles.kindIcon} style={{ color: iconColor(a) }}>
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className={styles.author}>{a.author || t('comments.unknownAuthor')}</span>
        <span className={styles.date}>{formatDate(a.modified)}</span>
      </header>
      {status !== 'None' && (
        <span className={styles.status} data-status={status} data-testid="comment-status-badge">
          {t(`comments.status.${status}`)}
        </span>
      )}

      {a.kind === 'freetext' && <p className={styles.preview}>{a.contents}</p>}
      {/* Die Beschriftung vorhandener Stempel liefert pdf.js nicht; dann steht dort nur „Stempel“. */}
      {a.kind === 'stamp' && <p className={styles.preview}>{a.label || t('tools.stamp')}</p>}
      {a.kind === 'signature' && <p className={styles.preview}>{t('tools.signature')}</p>}
      {a.kind === 'redact' && <p className={styles.preview}>{t('tools.redact')}</p>}

      {a.kind !== 'freetext' &&
        (selected && !readOnly ? (
          <EditableText
            value={text}
            label={t('comments.text')}
            placeholder={t('comments.textPlaceholder')}
            autoFocus={editing}
            onCommit={(value) => setContents(tabId, a.id, value)}
            onDone={() => {
              if (useAnnotations.getState().tabs[tabId]?.editingId === a.id) useAnnotations.getState().setEditing(tabId, null);
            }}
            testId="comment-text"
          />
        ) : (
          text && <p className={styles.text}>{text}</p>
        ))}

      {a.replies.length > 0 && (
        <ul className={styles.replies}>
          {a.replies.map((r) => (
            <li key={r.id} className={styles.reply} data-testid="comment-reply">
              <div className={styles.replyHeader}>
                <span className={styles.author}>{r.author || t('comments.unknownAuthor')}</span>
                <span className={styles.date}>{formatDate(r.modified)}</span>
                {selected && !readOnly && (
                  <IconButton
                    icon={X}
                    size={13}
                    className={styles.smallButton}
                    label={t('comments.deleteReply')}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteReply(tabId, a.id, r.id);
                    }}
                  />
                )}
              </div>
              {selected && !readOnly ? (
                <EditableText
                  value={r.contents}
                  label={t('comments.replyText')}
                  placeholder=""
                  autoFocus={false}
                  onCommit={(value) => (value.trim() ? editReply(tabId, a.id, r.id, value) : deleteReply(tabId, a.id, r.id))}
                  testId="comment-reply-text"
                />
              ) : (
                <p className={styles.text}>{r.contents}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected && !readOnly && (
        <footer className={styles.footer}>
          <input
            className={styles.replyInput}
            value={reply}
            placeholder={t('comments.replyPlaceholder')}
            aria-label={t('comments.reply')}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                submitReply();
              }
            }}
            data-testid="comment-reply-input"
          />
          <div className={styles.actions}>
            <select
              className={styles.statusSelect}
              value={status}
              aria-label={t('comments.statusLabel')}
              data-tooltip={t('comments.statusLabel')}
              onChange={(event) => setStatus(tabId, a.id, event.target.value as ReviewStatus)}
              data-testid="comment-status"
            >
              {REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`comments.status.${s}`)}
                </option>
              ))}
            </select>
            <IconButton
              icon={Trash}
              size={15}
              label={t('comments.delete')}
              onClick={(event) => {
                event.stopPropagation();
                deleteAnnotation(tabId, a.id);
              }}
              data-testid="comment-card-delete"
            />
          </div>
        </footer>
      )}
    </article>
  );
});

export function CommentsPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const annotations = useTabAnnotations(tab.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = annotations?.items;
  const selectedId = annotations?.selectedId ?? null;
  const editingId = annotations?.editingId ?? null;

  // Filter und Reihenfolge (je Liste; nach Seite mit Seitenüberschriften, sonst ohne)
  const [filter, setFilter] = useState<CommentFilter>({ type: 'all' });
  const [sort, setSort] = useState<CommentSort>('page');
  const shownItems = useMemo(() => (items ?? []).filter((a) => matches(a, filter)), [items, filter]);
  const authors = useMemo(() => authorsOf(items ?? []), [items]);
  const rows = useMemo<Row[]>(() => {
    const sorted = sortComments(shownItems, sort);
    const result: Row[] = [];
    let header: PageRow | undefined;
    for (const annotation of sorted) {
      if (sort === 'page' && (!header || header.pageIndex !== annotation.pageIndex)) {
        header = { type: 'page', pageIndex: annotation.pageIndex, count: 0 };
        result.push(header);
      }
      if (header) header.count++;
      result.push({ type: 'comment', annotation });
    }
    return result;
  }, [shownItems, sort]);

  const exportSummary = async () => {
    const text = commentSummary(shownItems, sort, {
      title: t('comments.summary.title', { name: tab.name }),
      page: (page) => t('comments.page', { page }),
      kind: (a) => t(`tools.${a.kind === 'squiggly' ? 'underline' : a.kind}`),
      status: (status) => t(`comments.status.${status}`),
      reply: (author) => t('comments.summary.reply', { author }),
      date: formatDate,
    });
    const result = await api.exportText(text, t('comments.summary.fileName', { name: tab.name.replace(/\.pdf$/i, '') }), tab.fileId);
    if (result.ok) useUi.getState().confirm(t('export.textDone', { name: result.name }));
    else if (result.error !== 'cancelled') useUi.getState().notify(t('export.failed'), result.detail ?? result.error);
  };

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'page' ? 28 : 72),
    overscan: 6,
    getItemKey: (index) => {
      const row = rows[index];
      return row?.type === 'page' ? `page-${row.pageIndex}` : (row?.annotation.id ?? index);
    },
  });

  // Ausgewählten Kommentar in der Liste sichtbar machen
  useEffect(() => {
    if (!selectedId) return;
    const index = rows.findIndex((row) => row.type === 'comment' && row.annotation.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedId, rows, virtualizer]);

  const count = items?.length ?? 0;
  return (
    <div className={styles.panel} data-testid="comments-panel">
      <div className={styles.summary}>
        {annotations?.loaded === false
          ? t('comments.loading')
          : filter.type === 'all'
            ? t('comments.count', { count })
            : t('comments.countFiltered', { shown: shownItems.length, count })}
      </div>
      {count > 0 && (
        <div className={styles.listTools}>
          <select
            className={styles.listSelect}
            aria-label={t('comments.filter.label')}
            data-tooltip={t('comments.filter.label')}
            value={filterKey(filter)}
            onChange={(event) => setFilter(parseFilterKey(event.target.value))}
            data-testid="comments-filter"
          >
            <option value="all">{t('comments.filter.all')}</option>
            <optgroup label={t('comments.filter.kind')}>
              {(Object.keys(KIND_GROUPS) as KindGroup[]).map((group) => (
                <option key={group} value={filterKey({ type: 'kind', group })}>
                  {t(`comments.filter.groups.${group}`)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('comments.filter.status')}>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={filterKey({ type: 'status', status })}>
                  {t(`comments.status.${status}`)}
                </option>
              ))}
            </optgroup>
            {authors.length > 0 && (
              <optgroup label={t('comments.filter.author')}>
                {authors.map((author) => (
                  <option key={author} value={filterKey({ type: 'author', author })}>
                    {author}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            className={styles.listSelect}
            aria-label={t('comments.sort.label')}
            data-tooltip={t('comments.sort.label')}
            value={sort}
            onChange={(event) => setSort(event.target.value as CommentSort)}
            data-testid="comments-sort"
          >
            <option value="page">{t('comments.sort.page')}</option>
            <option value="date">{t('comments.sort.date')}</option>
            <option value="author">{t('comments.sort.author')}</option>
          </select>
          <IconButton icon={FileDown} label={t('comments.summary.export')} size={16} onClick={() => void exportSummary()} disabled={shownItems.length === 0} data-testid="comments-export" />
        </div>
      )}
      <div ref={scrollRef} className={styles.scroller}>
        {count === 0 && annotations?.loaded !== false && <p className={styles.empty}>{t('comments.empty')}</p>}
        {count > 0 && shownItems.length === 0 && <p className={styles.empty}>{t('comments.filter.none')}</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className={styles.row}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.type === 'page' ? (
                  <h3 className={styles.pageHeader}>
                    {t('comments.page', { page: row.pageIndex + 1 })}
                    <span className={styles.pageCount}>{row.count}</span>
                  </h3>
                ) : (
                  <CommentCard
                    tabId={tab.id}
                    annotation={row.annotation}
                    selected={row.annotation.id === selectedId}
                    editing={row.annotation.id === editingId}
                    readOnly={!tab.canAnnotate}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
