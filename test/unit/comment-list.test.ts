import { describe, expect, it } from 'vitest';
import type { Annotation } from '../../src/shared/annotations';
import { authorsOf, commentSummary, filterKey, matches, parseFilterKey, sortComments, type SummaryLabels } from '../../src/renderer/features/annotations/comment-list';

const base = { ref: null, color: { r: 1, g: 0, b: 0 }, opacity: 1, replies: [], statuses: [], created: '' };
const note = (id: string, pageIndex: number, top: number, author: string, modified: string, contents = ''): Annotation => ({
  ...base,
  id,
  pageIndex,
  kind: 'note',
  icon: 'Comment',
  rect: [10, top - 20, 30, top],
  author,
  modified,
  contents,
});

const items: Annotation[] = [
  note('b', 1, 500, 'Zoe', 'D:20261020100000', 'Zweite Seite'),
  { ...note('a', 0, 700, 'Anna', 'D:20261019100000', 'Oben'), replies: [{ id: 'r', ref: null, author: 'Zoe', contents: 'Einverstanden', modified: 'D:20261021100000' }] },
  { ...note('c', 0, 300, 'Anna', 'D:20261022100000'), kind: 'highlight', quads: [], statuses: [{ id: 's', ref: null, status: 'Accepted', author: 'Zoe', modified: '' }] } as Annotation,
];

describe('Kommentarliste', () => {
  it('sortiert nach Seite, Datum und Verfasser', () => {
    expect(sortComments(items, 'page').map((a) => a.id)).toEqual(['a', 'c', 'b']);
    expect(sortComments(items, 'date').map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect(sortComments(items, 'author').map((a) => a.id)).toEqual(['a', 'c', 'b']);
  });

  it('filtert nach Art, Status und Verfasser; Schlüssel überstehen den Weg durch ein Auswahlfeld', () => {
    for (const filter of [{ type: 'all' }, { type: 'kind', group: 'markup' }, { type: 'status', status: 'Accepted' }, { type: 'author', author: 'Anna: Kollegin' }] as const) {
      expect(parseFilterKey(filterKey(filter))).toEqual(filter);
    }
    expect(items.filter((a) => matches(a, { type: 'kind', group: 'markup' })).map((a) => a.id)).toEqual(['c']);
    expect(items.filter((a) => matches(a, { type: 'status', status: 'Accepted' })).map((a) => a.id)).toEqual(['c']);
    expect(items.filter((a) => matches(a, { type: 'author', author: 'Zoe' })).map((a) => a.id)).toEqual(['b']);
    expect(authorsOf(items)).toEqual(['Anna', 'Zoe']);
  });

  it('fasst als Text zusammen, mit Seiten, Status und Antworten', () => {
    const labels: SummaryLabels = {
      title: 'Kommentare in test.pdf',
      page: (page) => `Seite ${page}`,
      kind: (a) => (a.kind === 'note' ? 'Notiz' : 'Hervorhebung'),
      status: (status) => (status === 'Accepted' ? 'Angenommen' : status),
      reply: (author) => `Antwort von ${author}`,
      date: (value) => value.slice(2, 10),
    };
    expect(commentSummary(items, 'page', labels)).toBe(
      [
        'Kommentare in test.pdf',
        '',
        'Seite 1',
        '',
        '• Notiz · Anna · 20261019',
        '  Oben',
        '  ↳ Antwort von Zoe · 20261021',
        '    Einverstanden',
        '',
        '• Hervorhebung · Anna · 20261022 · Angenommen',
        '',
        'Seite 2',
        '',
        '• Notiz · Zoe · 20261020',
        '  Zweite Seite',
        '',
      ].join('\n'),
    );
    // Nicht nach Seite sortiert: Seite steht beim Kommentar
    expect(commentSummary(items.slice(0, 1), 'date', labels)).toContain('• Notiz · Zoe · 20261020 · Seite 2');
  });
});
