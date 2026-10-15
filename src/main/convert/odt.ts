// OpenDocument-Text (.odt, LibreOffice, OpenOffice, Pages-Export) → Dokumentmodell. Übernimmt Absatz- und
// Zeichenformate (auch geerbte Vorlagen), Überschriften, Listen, Tabellen, Bilder, Links und das Seitenformat.
import { bulletChar, DEFAULT_PAGE, formatNumber, lengthToPt, normalizeColor, paragraph, type Block, type DocumentModel, type Inline, type PageSetup, type ParagraphStyle, type RunStyle, type TableCell } from './model';
import { child, childrenNamed, elements, find, findAll, parseXml, textContent, type XmlElement } from './xml';
import type { ZipArchive } from './zip';

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

interface OdtStyle {
  parent?: string;
  paragraph?: XmlElement;
  text?: XmlElement;
  cell?: XmlElement;
  listStyle?: string;
  outlineLevel?: number;
  breakBefore?: boolean;
  columnWidth?: number;
}

interface ListContext {
  style: string;
  level: number;
  // Nur der erste Absatz eines Listeneintrags trägt das Zeichen
  first: boolean;
}

function runFrom(props: XmlElement | undefined, into: RunStyle): RunStyle {
  if (!props) return into;
  const style = { ...into };
  const a = props.attrs;
  if (a['fo:font-weight']) style.bold = a['fo:font-weight'] === 'bold' || Number(a['fo:font-weight']) >= 600;
  if (a['fo:font-style']) style.italic = a['fo:font-style'] === 'italic' || a['fo:font-style'] === 'oblique';
  if (a['style:text-underline-style']) style.underline = a['style:text-underline-style'] !== 'none';
  if (a['style:text-line-through-style']) style.strike = a['style:text-line-through-style'] !== 'none';
  const color = normalizeColor(a['fo:color']);
  if (color) style.color = color;
  const background = a['fo:background-color'];
  if (background === 'transparent') delete style.background;
  else if (normalizeColor(background)) style.background = normalizeColor(background);
  const size = a['fo:font-size'];
  if (size?.endsWith('%')) {
    if (style.size) style.size = (style.size * Number.parseFloat(size)) / 100;
  } else {
    const points = lengthToPt(size);
    if (points) style.size = points;
  }
  const font = a['style:font-name'] ?? a['fo:font-family'];
  if (font) style.font = font.replace(/^'|'$/g, '');
  const position = a['style:text-position'];
  if (position?.startsWith('super') || /^\d/.test(position ?? '') && Number.parseFloat(position ?? '0') > 0) style.vertical = 'super';
  else if (position?.startsWith('sub') || /^-\d/.test(position ?? '')) style.vertical = 'sub';
  if (a['fo:font-variant'] === 'small-caps') style.smallCaps = true;
  if (a['fo:text-transform'] === 'uppercase') style.caps = true;
  return style;
}

function paragraphFrom(props: XmlElement | undefined, into: ParagraphStyle): ParagraphStyle {
  if (!props) return into;
  const style = { ...into };
  const a = props.attrs;
  const align = a['fo:text-align'];
  if (align) style.align = align === 'center' ? 'center' : align === 'end' || align === 'right' ? 'right' : align === 'justify' ? 'justify' : 'left';
  const set = (key: 'indentLeft' | 'indentRight' | 'indentFirst' | 'spaceBefore' | 'spaceAfter', value: string | undefined) => {
    const points = lengthToPt(value);
    if (points !== undefined) style[key] = points;
  };
  set('indentLeft', a['fo:margin-left']);
  set('indentRight', a['fo:margin-right']);
  set('indentFirst', a['fo:text-indent']);
  set('spaceBefore', a['fo:margin-top']);
  set('spaceAfter', a['fo:margin-bottom']);
  const line = a['fo:line-height'];
  if (line?.endsWith('%')) style.lineHeight = { multiple: Number.parseFloat(line) / 100 };
  else if (lengthToPt(line)) style.lineHeight = { exact: lengthToPt(line) as number };
  if (a['fo:break-before'] === 'page') style.pageBreakBefore = true;
  const background = normalizeColor(a['fo:background-color']);
  if (background) style.background = background;
  return style;
}

class OdtReader {
  readonly styles = new Map<string, OdtStyle>();
  readonly listStyles = new Map<string, XmlElement>();
  readonly counters = new Map<string, number[]>();
  defaultRun: RunStyle = {};
  defaultParagraph: ParagraphStyle = {};
  readonly notes: Block[][] = [];
  readonly fonts = new Map<string, string>();

  constructor(private readonly zip: ZipArchive) {}

  addStyles(root: XmlElement | undefined): void {
    for (const node of findAll(root, 'style:font-face')) {
      const family = node.attrs['svg:font-family'];
      if (family) this.fonts.set(node.attrs['style:name'] ?? '', family.replace(/^'|'$/g, ''));
    }
    for (const node of findAll(root, 'style:default-style')) {
      if (node.attrs['style:family'] !== 'paragraph') continue;
      this.defaultRun = runFrom(child(node, 'style:text-properties'), this.defaultRun);
      this.defaultParagraph = paragraphFrom(child(node, 'style:paragraph-properties'), this.defaultParagraph);
    }
    for (const node of findAll(root, 'style:style')) {
      const level = node.attrs['style:default-outline-level'];
      const paragraphProps = child(node, 'style:paragraph-properties');
      this.styles.set(node.attrs['style:name'] ?? '', {
        parent: node.attrs['style:parent-style-name'],
        paragraph: paragraphProps,
        text: child(node, 'style:text-properties'),
        cell: child(node, 'style:table-cell-properties'),
        listStyle: node.attrs['style:list-style-name'],
        outlineLevel: level ? Number(level) : undefined,
        breakBefore: paragraphProps?.attrs['fo:break-before'] === 'page',
        columnWidth: lengthToPt(child(node, 'style:table-column-properties')?.attrs['style:column-width']),
      });
    }
    for (const node of findAll(root, 'text:list-style')) this.listStyles.set(node.attrs['style:name'] ?? '', node);
  }

  chain(name: string | undefined): OdtStyle[] {
    const chain: OdtStyle[] = [];
    let current = name;
    for (let i = 0; current && i < 20; i++) {
      const style = this.styles.get(current);
      if (!style) break;
      chain.unshift(style);
      current = style.parent;
    }
    return chain;
  }

  run(name: string | undefined, base: RunStyle): RunStyle {
    let style = base;
    for (const entry of this.chain(name)) style = runFrom(entry.text, style);
    if (style.font && this.fonts.has(style.font)) style = { ...style, font: this.fonts.get(style.font) };
    return style;
  }

  image(href: string | undefined): string | null {
    if (!href || /^[a-z]+:/i.test(href)) return null;
    const path = href.replace(/^\.\//, '');
    const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
    const data = type ? this.zip.read(path) : null;
    return type && data ? `data:${type};base64,${Buffer.from(data).toString('base64')}` : null;
  }

  blocks(container: XmlElement | undefined, list?: ListContext): Block[] {
    const blocks: Block[] = [];
    for (const node of elements(container)) {
      switch (node.name) {
        case 'text:p':
        case 'text:h':
          blocks.push(this.paragraph(node, list));
          break;
        case 'text:list': {
          const style = node.attrs['text:style-name'] ?? list?.style ?? '';
          const level = list ? list.level + 1 : 0;
          if (node.attrs['text:continue-numbering'] !== 'true' && !list) this.counters.delete(style);
          for (const item of elements(node)) {
            if (item.name === 'text:list-item' || item.name === 'text:list-header') blocks.push(...this.blocks(item, { style, level, first: item.name === 'text:list-item' }));
          }
          break;
        }
        case 'table:table':
          blocks.push(this.table(node));
          break;
        case 'text:section':
        case 'text:index-body':
        case 'text:table-of-content':
        case 'text:alphabetical-index':
        case 'text:illustration-index':
          blocks.push(...this.blocks(node.name === 'text:section' ? node : (child(node, 'text:index-body') ?? node), list));
          break;
      }
    }
    return blocks;
  }

  private marker(list: ListContext): string | undefined {
    if (!list.first) return undefined;
    list.first = false;
    const definition = this.listStyles.get(list.style);
    const levels = elements(definition);
    const level = levels.find((entry) => Number(entry.attrs['text:level'] ?? 1) === list.level + 1);
    if (!level) return '•';
    if (level.name === 'text:list-level-style-bullet') return bulletChar(level.attrs['text:bullet-char'] ?? '•');
    if (level.name !== 'text:list-level-style-number') return undefined;
    let counters = this.counters.get(list.style);
    if (!counters) {
      counters = [];
      this.counters.set(list.style, counters);
    }
    counters[list.level] = (counters[list.level] ?? Number(level.attrs['text:start-value'] ?? 1) - 1) + 1;
    counters.length = list.level + 1;
    const shown = Math.min(Number(level.attrs['text:display-levels'] ?? 1), list.level + 1);
    const format = level.attrs['style:num-format'] ?? '1';
    const parts: string[] = [];
    for (let l = list.level + 1 - shown; l <= list.level; l++) {
      const levelFormat = levels.find((entry) => Number(entry.attrs['text:level'] ?? 1) === l + 1)?.attrs['style:num-format'] ?? format;
      parts.push(formatNumber(counters[l] ?? 1, levelFormat));
    }
    return `${level.attrs['style:num-prefix'] ?? ''}${parts.join('.')}${level.attrs['style:num-suffix'] ?? ''}`;
  }

  private paragraph(node: XmlElement, list?: ListContext): Block {
    const name = node.attrs['text:style-name'];
    const chain = this.chain(name);
    let pStyle: ParagraphStyle = { ...this.defaultParagraph };
    for (const entry of chain) pStyle = paragraphFrom(entry.paragraph, pStyle);
    const run = this.run(name, this.defaultRun);
    pStyle.run = run;
    const outline = node.name === 'text:h' ? Number(node.attrs['text:outline-level'] ?? 1) : undefined;
    const inlines: Inline[] = [];
    this.inlines(node, run, undefined, inlines, { pending: true });
    const marker = list ? this.marker(list) : undefined;
    if (list) {
      pStyle.indentLeft = (pStyle.indentLeft ?? 0) + 18 * (list.level + 1);
      pStyle.indentFirst = -18;
    }
    return paragraph(inlines, pStyle, { ...(outline ? { heading: Math.min(6, outline) } : {}), ...(marker !== undefined ? { marker } : {}) });
  }

  private inlines(container: XmlElement, base: RunStyle, link: string | undefined, out: Inline[], space: { pending: boolean }): void {
    for (const node of container.children) {
      if (typeof node === 'string') {
        // XML-Leerraum wird wie in HTML zusammengefasst
        const collapsed = node.replace(/[\s]+/g, ' ');
        const value = space.pending ? collapsed.replace(/^ /, '') : collapsed;
        if (value) {
          out.push({ kind: 'text', text: value, style: base, ...(link ? { link } : {}) });
          space.pending = value.endsWith(' ');
        }
        continue;
      }
      switch (node.name) {
        case 'text:span':
          this.inlines(node, this.run(node.attrs['text:style-name'], base), link, out, space);
          break;
        case 'text:a':
          this.inlines(node, base, node.attrs['xlink:href'], out, space);
          break;
        case 'text:s':
          out.push({ kind: 'text', text: ' '.repeat(Math.min(100, Number(node.attrs['text:c'] ?? 1))), style: base });
          break;
        case 'text:tab':
          out.push({ kind: 'tab' });
          space.pending = false;
          break;
        case 'text:line-break':
          out.push({ kind: 'break' });
          space.pending = true;
          break;
        case 'text:note': {
          const body = child(node, 'text:note-body');
          this.notes.push(this.blocks(body));
          out.push({ kind: 'text', text: String(this.notes.length), style: { ...base, vertical: 'super' } });
          break;
        }
        case 'draw:frame': {
          const image = child(node, 'draw:image');
          const src = this.image(image?.attrs['xlink:href']);
          const alt = textContent(child(node, 'svg:desc')) || textContent(child(node, 'svg:title'));
          if (src) out.push({ kind: 'image', src, width: lengthToPt(node.attrs['svg:width']) ?? null, height: lengthToPt(node.attrs['svg:height']) ?? null, ...(alt ? { alt } : {}) });
          break;
        }
        case 'text:soft-page-break':
        case 'text:bookmark':
        case 'text:bookmark-start':
        case 'text:bookmark-end':
        case 'office:annotation':
        case 'office:annotation-end':
          break;
        default:
          // Felder (Datum, Seitenzahl, Verweise …): zuletzt berechneten Text übernehmen
          if (node.name.startsWith('text:')) this.inlines(node, base, link, out, space);
      }
    }
  }

  private table(node: XmlElement): Block {
    const rows: TableCell[][] = [];
    const columnWidths: number[] = [];
    for (const column of findAll(node, 'table:table-column')) {
      const width = this.styles.get(column.attrs['table:style-name'] ?? '')?.columnWidth;
      const repeat = Math.min(100, Number(column.attrs['table:number-columns-repeated'] ?? 1));
      for (let i = 0; i < repeat; i++) columnWidths.push(width ?? 0);
    }
    let borders = false;
    const headerRows = new Set(childrenNamed(child(node, 'table:table-header-rows'), 'table:table-row'));
    const ordered = elements(node).flatMap((entry) => (entry.name === 'table:table-row' ? [entry] : entry.name === 'table:table-header-rows' || entry.name === 'table:table-rows' ? childrenNamed(entry, 'table:table-row') : []));
    for (const tr of ordered) {
      const row: TableCell[] = [];
      for (const tc of childrenNamed(tr, 'table:table-cell')) {
        const style = this.chain(tc.attrs['table:style-name']).reduce<XmlElement | undefined>((found, entry) => entry.cell ?? found, undefined);
        const border = style?.attrs['fo:border'] ?? style?.attrs['fo:border-top'];
        if (border && border !== 'none') borders = true;
        const background = normalizeColor(style?.attrs['fo:background-color']);
        row.push({
          blocks: this.blocks(tc),
          colSpan: Number(tc.attrs['table:number-columns-spanned'] ?? 1),
          rowSpan: Number(tc.attrs['table:number-rows-spanned'] ?? 1),
          ...(background ? { background } : {}),
          ...(headerRows.has(tr) ? { header: true } : {}),
        });
      }
      rows.push(row);
    }
    return { kind: 'table', rows, borders, ...(columnWidths.length > 0 && columnWidths.every((w) => w > 0) ? { columnWidths } : {}) };
  }
}

export function convertOdt(zip: ZipArchive): DocumentModel {
  const content = zip.text('content.xml');
  if (!content) throw new Error('kein OpenDocument');
  const reader = new OdtReader(zip);
  const stylesSource = zip.text('styles.xml');
  const stylesRoot = stylesSource ? parseXml(stylesSource) : undefined;
  reader.addStyles(stylesRoot);
  const contentRoot = parseXml(content);
  reader.addStyles(find(contentRoot, 'office:automatic-styles'));
  reader.addStyles(find(contentRoot, 'office:font-face-decls'));
  const blocks = reader.blocks(find(contentRoot, 'office:text'));
  const layout = find(stylesRoot, 'style:page-layout-properties');
  const length = (name: string, fallback: number) => lengthToPt(layout?.attrs[name]) ?? fallback;
  const page: PageSetup = {
    width: length('fo:page-width', DEFAULT_PAGE.width),
    height: length('fo:page-height', DEFAULT_PAGE.height),
    margins: {
      top: length('fo:margin-top', DEFAULT_PAGE.margins.top),
      right: length('fo:margin-right', DEFAULT_PAGE.margins.right),
      bottom: length('fo:margin-bottom', DEFAULT_PAGE.margins.bottom),
      left: length('fo:margin-left', DEFAULT_PAGE.margins.left),
    },
  };
  const meta = zip.text('meta.xml');
  const title = meta ? textContent(find(parseXml(meta), 'dc:title')).trim() || null : null;
  const language = find(stylesRoot, 'style:default-style');
  const lang = child(language, 'style:text-properties')?.attrs['fo:language'];
  const country = child(language, 'style:text-properties')?.attrs['fo:country'];
  const font = reader.defaultRun.font ? (reader.fonts.get(reader.defaultRun.font) ?? reader.defaultRun.font) : null;
  return { title, lang: lang && lang !== 'none' ? (country && country !== 'none' ? `${lang}-${country}` : lang) : null, page, font, size: reader.defaultRun.size ?? 12, blocks, notes: reader.notes };
}
