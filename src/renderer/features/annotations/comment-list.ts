// Kommentarliste filtern, sortieren und als Text zusammenfassen (ohne DOM, damit testbar)
import type { Annotation, AnnotationKind, ReviewStatus } from '../../../shared/annotations';
import { currentStatus, parsePdfDate } from '../../../shared/annotations';

export type CommentSort = 'page' | 'date' | 'author';

export type KindGroup = 'markup' | 'notes' | 'drawings' | 'stamps' | 'redact';

export const KIND_GROUPS: Record<KindGroup, readonly AnnotationKind[]> = {
  markup: ['highlight', 'underline', 'strikeout', 'squiggly'],
  notes: ['note', 'freetext'],
  drawings: ['ink', 'square', 'circle', 'line', 'arrow'],
  stamps: ['stamp', 'signature'],
  redact: ['redact'],
};

// Ein Filter: alle, eine Art von Kommentaren, ein Prüfstatus oder ein Verfasser
export type CommentFilter = { type: 'all' } | { type: 'kind'; group: KindGroup } | { type: 'status'; status: ReviewStatus } | { type: 'author'; author: string };

// Als Wert eines Auswahlfelds (z. B. „kind:notes“, „author:Max“) und zurück
export function filterKey(filter: CommentFilter): string {
  switch (filter.type) {
    case 'all':
      return 'all';
    case 'kind':
      return `kind:${filter.group}`;
    case 'status':
      return `status:${filter.status}`;
    case 'author':
      return `author:${filter.author}`;
  }
}

export function parseFilterKey(key: string): CommentFilter {
  const [type, ...rest] = key.split(':');
  const value = rest.join(':');
  if (type === 'kind' && value in KIND_GROUPS) return { type: 'kind', group: value as KindGroup };
  if (type === 'status' && value) return { type: 'status', status: value as ReviewStatus };
  if (type === 'author') return { type: 'author', author: value };
  return { type: 'all' };
}

export function matches(a: Annotation, filter: CommentFilter): boolean {
  switch (filter.type) {
    case 'all':
      return true;
    case 'kind':
      return KIND_GROUPS[filter.group].includes(a.kind);
    case 'status':
      return currentStatus(a) === filter.status;
    case 'author':
      return a.author === filter.author;
  }
}

const time = (a: Annotation) => parsePdfDate(a.modified || a.created)?.getTime() ?? 0;
const byPosition = (a: Annotation, b: Annotation) => a.pageIndex - b.pageIndex || b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0];

// Seite: von oben nach unten; Datum: neueste zuerst; Verfasser: alphabetisch, dann nach Seite
export function sortComments(items: readonly Annotation[], sort: CommentSort): Annotation[] {
  const list = [...items];
  if (sort === 'date') return list.sort((a, b) => time(b) - time(a) || byPosition(a, b));
  if (sort === 'author') return list.sort((a, b) => a.author.localeCompare(b.author, 'de') || byPosition(a, b));
  return list.sort(byPosition);
}

export function authorsOf(items: readonly Annotation[]): string[] {
  return [...new Set(items.map((a) => a.author).filter((author) => author.trim() !== ''))].sort((a, b) => a.localeCompare(b, 'de'));
}

export interface SummaryLabels {
  title: string;
  page: (page: number) => string;
  kind: (a: Annotation) => string;
  status: (status: ReviewStatus) => string;
  reply: (author: string) => string;
  date: (value: string) => string;
}

// Zusammenfassung als Text: Überschrift, dann je Kommentar Art, Verfasser, Datum, Status, Text und Antworten
export function commentSummary(items: readonly Annotation[], sort: CommentSort, labels: SummaryLabels): string {
  const lines: string[] = [labels.title, ''];
  let page = -1;
  for (const a of sortComments(items, sort)) {
    if (sort === 'page' && a.pageIndex !== page) {
      page = a.pageIndex;
      lines.push(labels.page(page + 1), '');
    }
    const status = currentStatus(a);
    const head = [labels.kind(a), a.author, labels.date(a.modified || a.created), status !== 'None' ? labels.status(status) : '', sort !== 'page' ? labels.page(a.pageIndex + 1) : '']
      .filter((part) => part.trim() !== '')
      .join(' · ');
    lines.push(`• ${head}`);
    for (const text of [a.contents, a.kind === 'stamp' ? a.label.replace('\n', ' – ') : ''].filter((value) => value.trim() !== '')) {
      for (const line of text.trim().split('\n')) lines.push(`  ${line}`);
    }
    for (const reply of a.replies) {
      lines.push(`  ↳ ${[labels.reply(reply.author), labels.date(reply.modified)].filter((part) => part.trim() !== '').join(' · ')}`);
      for (const line of reply.contents.trim().split('\n')) if (line.trim() !== '') lines.push(`    ${line}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
