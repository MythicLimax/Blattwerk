// Textausschnitt rund um einen Suchtreffer für die Ergebnisliste.
//
// pdf.js liefert Trefferpositionen im aneinandergehängten Text aller Textstücke einer Seite, ohne Zeichen
// für Zeilenenden (so ist auch die Textebene aufgebaut). Damit der Ausschnitt trotzdem lesbar bleibt,
// merken wir uns die Stellen der Zeilenenden und zeigen dort ein Leerzeichen.
export interface PageText {
  text: string;
  // Positionen im Text, an denen eine Zeile endet (aufsteigend)
  breaks: number[];
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export function joinTextItems(items: ReadonlyArray<{ str?: string; hasEOL?: boolean }>): PageText {
  let text = '';
  const breaks: number[] = [];
  for (const item of items) {
    if (typeof item.str === 'string') text += item.str;
    if (item.hasEOL) breaks.push(text.length);
  }
  return { text, breaks };
}

// Text zwischen from und to, mit Leerzeichen an Zeilenenden. Ein Zeilenende genau an einer Grenze
// zählt zu dem Teil, auf dessen Seite es per Parameter gehört.
function segment(page: PageText, from: number, to: number, breakAtStart: boolean, breakAtEnd: boolean): string {
  let out = breakAtStart && page.breaks.includes(from) && from > 0 ? ' ' : '';
  let pos = from;
  for (const b of page.breaks) {
    if (b <= from || b > to || (b === to && !breakAtEnd)) continue;
    out += page.text.slice(pos, b) + ' ';
    pos = b;
  }
  return out + page.text.slice(pos, to);
}

export function snippetAround(page: PageText, start: number, length: number, context = 40): Snippet | null {
  const { text } = page;
  if (start < 0 || length <= 0 || start + length > text.length) return null;
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  const end = start + length;
  const from = Math.max(0, start - context);
  const to = Math.min(text.length, end + context);
  return {
    before: (from > 0 ? '…' : '') + clean(segment(page, from, start, false, true)).trimStart(),
    match: clean(segment(page, start, end, false, false)),
    after: clean(segment(page, end, to, true, false)).trimEnd() + (to < text.length ? '…' : ''),
  };
}
