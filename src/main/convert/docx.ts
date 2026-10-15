// Word-Dokumente (.docx, Office Open XML) → Dokumentmodell. Übernimmt Absätze mit Formatvorlagen, Zeichenformat,
// Ausrichtung, Einzüge, Abstände, Überschriften, Listen mit Nummerierung, Tabellen (verbundene Zellen, Schattierung),
// eingebettete Bilder, Links, Seitenumbrüche, Seitenformat und Fußnoten. Kopf- und Fußzeilen, Textfelder und
// Formen entfallen (vereinfachtes Layout, siehe ADR 0019).
import { bulletChar, DEFAULT_PAGE, emuToPt, formatNumber, normalizeColor, paragraph, twipsToPt, type Block, type DocumentModel, type Inline, type ParagraphStyle, type RunStyle, type TableCell } from './model';
import { child, childrenNamed, elements, find, parseXml, textContent, type XmlElement } from './xml';
import type { ZipArchive } from './zip';

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

const attr = (node: XmlElement | undefined, name: string): string | undefined => node?.attrs[`w:${name}`] ?? node?.attrs[name];
const num = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
};
// Schalter wie <w:b/> oder <w:b w:val="0"/>
const toggle = (node: XmlElement | undefined): boolean | undefined => {
  if (!node) return undefined;
  const value = attr(node, 'val');
  return value === undefined || !['0', 'false', 'off', 'none'].includes(value);
};

interface Style {
  type: string;
  name: string;
  basedOn?: string;
  pPr?: XmlElement;
  rPr?: XmlElement;
  tblPr?: XmlElement;
}

interface NumberingLevel {
  format: string;
  text: string;
  start: number;
  pPr?: XmlElement;
  rPr?: XmlElement;
}

function readRels(zip: ZipArchive, path: string): Map<string, { target: string; external: boolean }> {
  const rels = new Map<string, { target: string; external: boolean }>();
  const source = zip.text(path);
  if (!source) return rels;
  for (const rel of elements(child(parseXml(source), 'Relationships'))) {
    rels.set(rel.attrs.Id ?? '', { target: rel.attrs.Target ?? '', external: rel.attrs.TargetMode === 'External' });
  }
  return rels;
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

// Schriften des Designs (theme1.xml): „minor“ für Fließtext, „major“ für Überschriften
interface ThemeFonts {
  minor?: string;
  major?: string;
}

function runStyleFrom(rPr: XmlElement | undefined, into: RunStyle, theme: ThemeFonts = {}): RunStyle {
  if (!rPr) return into;
  const style = { ...into };
  const set = <K extends keyof RunStyle>(key: K, value: RunStyle[K] | undefined) => {
    if (value !== undefined) style[key] = value;
  };
  set('bold', toggle(child(rPr, 'w:b')));
  set('italic', toggle(child(rPr, 'w:i')));
  const underline = child(rPr, 'w:u');
  if (underline) style.underline = attr(underline, 'val') !== 'none';
  set('strike', toggle(child(rPr, 'w:strike')) ?? toggle(child(rPr, 'w:dstrike')));
  set('caps', toggle(child(rPr, 'w:caps')));
  set('smallCaps', toggle(child(rPr, 'w:smallCaps')));
  const color = attr(child(rPr, 'w:color'), 'val');
  if (color === 'auto') delete style.color;
  else set('color', normalizeColor(color));
  const size = num(attr(child(rPr, 'w:sz'), 'val'));
  if (size) style.size = size / 2;
  const fonts = child(rPr, 'w:rFonts');
  const themed = attr(fonts, 'asciiTheme') ?? attr(fonts, 'hAnsiTheme');
  const font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? (themed ? (themed.startsWith('major') ? theme.major : theme.minor) : undefined) ?? attr(fonts, 'cs');
  if (font) style.font = font;
  const highlight = attr(child(rPr, 'w:highlight'), 'val');
  const HIGHLIGHT: Record<string, string> = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000' };
  const shading = normalizeColor(attr(child(rPr, 'w:shd'), 'fill'));
  if (highlight && HIGHLIGHT[highlight]) style.background = HIGHLIGHT[highlight];
  else if (shading) style.background = shading;
  const vertical = attr(child(rPr, 'w:vertAlign'), 'val');
  if (vertical === 'superscript') style.vertical = 'super';
  else if (vertical === 'subscript') style.vertical = 'sub';
  else if (vertical === 'baseline') delete style.vertical;
  return style;
}

function paragraphStyleFrom(pPr: XmlElement | undefined, into: ParagraphStyle): ParagraphStyle {
  if (!pPr) return into;
  const style = { ...into };
  const jc = attr(child(pPr, 'w:jc'), 'val');
  if (jc) style.align = jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : 'left';
  const ind = child(pPr, 'w:ind');
  if (ind) {
    const left = num(attr(ind, 'left') ?? attr(ind, 'start'));
    const right = num(attr(ind, 'right') ?? attr(ind, 'end'));
    const first = num(attr(ind, 'firstLine'));
    const hanging = num(attr(ind, 'hanging'));
    if (left !== undefined) style.indentLeft = twipsToPt(left);
    if (right !== undefined) style.indentRight = twipsToPt(right);
    if (hanging !== undefined) style.indentFirst = -twipsToPt(hanging);
    else if (first !== undefined) style.indentFirst = twipsToPt(first);
  }
  const spacing = child(pPr, 'w:spacing');
  if (spacing) {
    const before = num(attr(spacing, 'before'));
    const after = num(attr(spacing, 'after'));
    if (before !== undefined && attr(spacing, 'beforeAutospacing') !== '1') style.spaceBefore = twipsToPt(before);
    if (after !== undefined && attr(spacing, 'afterAutospacing') !== '1') style.spaceAfter = twipsToPt(after);
    const line = num(attr(spacing, 'line'));
    const rule = attr(spacing, 'lineRule') ?? 'auto';
    if (line !== undefined && line > 0) style.lineHeight = rule === 'auto' ? { multiple: line / 240 } : { exact: twipsToPt(line) };
  }
  if (toggle(child(pPr, 'w:pageBreakBefore'))) style.pageBreakBefore = true;
  const shading = normalizeColor(attr(child(pPr, 'w:shd'), 'fill'));
  if (shading) style.background = shading;
  return style;
}

class DocxReader {
  readonly styles = new Map<string, Style>();
  readonly abstractLevels = new Map<string, Map<number, NumberingLevel>>();
  readonly nums = new Map<string, { abstract: string; overrides: Map<number, number> }>();
  readonly counters = new Map<string, number[]>();
  readonly rels: Map<string, { target: string; external: boolean }>;
  defaultRun: RunStyle = {};
  defaultParagraph: ParagraphStyle = {};
  defaultParagraphStyle: string | undefined;
  lang: string | null = null;
  readonly notes: Block[][] = [];
  readonly footnotes = new Map<string, XmlElement>();
  readonly images = new Map<string, string | null>();
  readonly theme: ThemeFonts = {};

  constructor(private readonly zip: ZipArchive, private readonly documentPath: string) {
    this.rels = readRels(zip, resolvePath(documentPath, `_rels/${documentPath.split('/').pop()}.rels`));
    const themePath = this.part('theme1.xml');
    const theme = themePath ? this.zip.text(themePath) : null;
    if (theme) {
      const root = parseXml(theme);
      this.theme.minor = find(find(root, 'a:minorFont'), 'a:latin')?.attrs.typeface || undefined;
      this.theme.major = find(find(root, 'a:majorFont'), 'a:latin')?.attrs.typeface || undefined;
    }
    this.readStyles();
    this.readNumbering();
    this.readFootnotes();
  }

  private part(type: string): string | null {
    for (const rel of this.rels.values()) if (rel.target.toLowerCase().endsWith(type)) return resolvePath(this.documentPath, rel.target);
    const fallback = `word/${type}`;
    return this.zip.has(fallback) ? fallback : null;
  }

  private readStyles(): void {
    const path = this.part('styles.xml');
    const source = path ? this.zip.text(path) : null;
    if (!source) return;
    const root = child(parseXml(source), 'w:styles');
    const defaults = child(root, 'w:docDefaults');
    const rPrDefault = child(child(defaults, 'w:rPrDefault'), 'w:rPr');
    this.defaultRun = runStyleFrom(rPrDefault, {}, this.theme);
    this.lang = attr(child(rPrDefault, 'w:lang'), 'val') ?? null;
    this.defaultParagraph = paragraphStyleFrom(child(child(defaults, 'w:pPrDefault'), 'w:pPr'), {});
    for (const node of childrenNamed(root, 'w:style')) {
      const id = attr(node, 'styleId');
      if (!id) continue;
      const style: Style = {
        type: attr(node, 'type') ?? 'paragraph',
        name: attr(child(node, 'w:name'), 'val') ?? id,
        basedOn: attr(child(node, 'w:basedOn'), 'val'),
        pPr: child(node, 'w:pPr'),
        rPr: child(node, 'w:rPr'),
        tblPr: child(node, 'w:tblPr'),
      };
      this.styles.set(id, style);
      if (style.type === 'paragraph' && ['1', 'true', 'on'].includes(node.attrs['w:default'] ?? '')) this.defaultParagraphStyle = id;
    }
  }

  // Kette der Formatvorlagen von der Basis bis zur genannten
  styleChain(id: string | undefined): Style[] {
    const chain: Style[] = [];
    let current = id;
    for (let i = 0; current && i < 20; i++) {
      const style = this.styles.get(current);
      if (!style) break;
      chain.unshift(style);
      current = style.basedOn;
    }
    return chain;
  }

  headingLevel(styleId: string | undefined, pPr: XmlElement | undefined): number | undefined {
    const outline = num(attr(child(pPr, 'w:outlineLvl'), 'val'));
    if (outline !== undefined && outline < 9) return Math.min(6, outline + 1);
    for (const style of this.styleChain(styleId).reverse()) {
      const level = num(attr(child(style.pPr, 'w:outlineLvl'), 'val'));
      if (level !== undefined && level < 9) return Math.min(6, level + 1);
      const match = /^(heading|überschrift|titre|titolo|kop)\s*(\d)$/i.exec(style.name);
      if (match) return Math.min(6, Number(match[2]));
    }
    return undefined;
  }

  private readNumbering(): void {
    const path = this.part('numbering.xml');
    const source = path ? this.zip.text(path) : null;
    if (!source) return;
    const root = child(parseXml(source), 'w:numbering');
    for (const abstract of childrenNamed(root, 'w:abstractNum')) {
      const levels = new Map<number, NumberingLevel>();
      for (const lvl of childrenNamed(abstract, 'w:lvl')) {
        levels.set(num(attr(lvl, 'ilvl')) ?? 0, {
          format: attr(child(lvl, 'w:numFmt'), 'val') ?? 'decimal',
          text: attr(child(lvl, 'w:lvlText'), 'val') ?? '',
          start: num(attr(child(lvl, 'w:start'), 'val')) ?? 1,
          pPr: child(lvl, 'w:pPr'),
          rPr: child(lvl, 'w:rPr'),
        });
      }
      this.abstractLevels.set(attr(abstract, 'abstractNumId') ?? '', levels);
    }
    for (const numNode of childrenNamed(root, 'w:num')) {
      const overrides = new Map<number, number>();
      for (const override of childrenNamed(numNode, 'w:lvlOverride')) {
        const start = num(attr(child(override, 'w:startOverride'), 'val'));
        if (start !== undefined) overrides.set(num(attr(override, 'ilvl')) ?? 0, start);
      }
      this.nums.set(attr(numNode, 'numId') ?? '', { abstract: attr(child(numNode, 'w:abstractNumId'), 'val') ?? '', overrides });
    }
  }

  private readFootnotes(): void {
    const path = this.part('footnotes.xml');
    const source = path ? this.zip.text(path) : null;
    if (!source) return;
    for (const note of childrenNamed(child(parseXml(source), 'w:footnotes'), 'w:footnote')) {
      const type = attr(note, 'type');
      if (!type || type === 'normal') this.footnotes.set(attr(note, 'id') ?? '', note);
    }
  }

  // Nummer bzw. Aufzählungszeichen und Einzug der Liste
  listMarker(numId: string, level: number): { marker: string; pPr?: XmlElement; rPr?: XmlElement } | null {
    const numbering = this.nums.get(numId);
    const levels = numbering ? this.abstractLevels.get(numbering.abstract) : undefined;
    const definition = levels?.get(level);
    if (!numbering || !levels || !definition) return null;
    let counters = this.counters.get(numId);
    if (!counters) {
      counters = [];
      this.counters.set(numId, counters);
    }
    for (let l = 0; l <= level; l++) {
      if (counters[l] === undefined) counters[l] = (numbering.overrides.get(l) ?? levels.get(l)?.start ?? 1) - (l === level ? 1 : 0);
    }
    counters[level] = (counters[level] as number) + 1;
    counters.length = level + 1;
    if (definition.format === 'bullet') {
      const font = attr(child(definition.rPr, 'w:rFonts'), 'ascii');
      return { marker: bulletChar(definition.text, font), pPr: definition.pPr, rPr: definition.rPr };
    }
    const marker = definition.text.replace(/%(\d)/g, (_, digit: string) => {
      const l = Number(digit) - 1;
      return formatNumber(counters[l] ?? levels.get(l)?.start ?? 1, levels.get(l)?.format ?? 'decimal');
    });
    return { marker, pPr: definition.pPr, rPr: definition.rPr };
  }

  image(relId: string | undefined): string | null {
    if (!relId) return null;
    if (this.images.has(relId)) return this.images.get(relId) ?? null;
    const rel = this.rels.get(relId);
    let result: string | null = null;
    if (rel && !rel.external) {
      const path = resolvePath(this.documentPath, rel.target);
      const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
      const data = type ? this.zip.read(path) : null;
      if (type && data) result = `data:${type};base64,${Buffer.from(data).toString('base64')}`;
    }
    this.images.set(relId, result);
    return result;
  }

  blocks(container: XmlElement | undefined): Block[] {
    const blocks: Block[] = [];
    for (const node of elements(container)) {
      if (node.name === 'w:p') blocks.push(...this.paragraph(node));
      else if (node.name === 'w:tbl') blocks.push(this.table(node));
      else if (node.name === 'w:sdt') blocks.push(...this.blocks(child(node, 'w:sdtContent')));
      else if (node.name === 'w:customXml' || node.name === 'w:ins' || node.name === 'w:smartTag') blocks.push(...this.blocks(node));
    }
    return blocks;
  }

  private paragraph(node: XmlElement): Block[] {
    const pPr = child(node, 'w:pPr');
    const styleId = attr(child(pPr, 'w:pStyle'), 'val') ?? this.defaultParagraphStyle;
    const chain = this.styleChain(styleId);
    let pStyle: ParagraphStyle = { ...this.defaultParagraph };
    let rStyle: RunStyle = { ...this.defaultRun };
    for (const style of chain) {
      pStyle = paragraphStyleFrom(style.pPr, pStyle);
      rStyle = runStyleFrom(style.rPr, rStyle, this.theme);
    }
    // Nummerierung: direkt am Absatz oder über die Formatvorlage
    const numPr = child(pPr, 'w:numPr') ?? [...chain].reverse().map((style) => child(style.pPr, 'w:numPr')).find(Boolean);
    const numId = attr(child(numPr, 'w:numId'), 'val');
    let marker: string | undefined;
    if (numId && numId !== '0') {
      const list = this.listMarker(numId, num(attr(child(numPr, 'w:ilvl'), 'val')) ?? 0);
      if (list) {
        marker = list.marker;
        pStyle = paragraphStyleFrom(list.pPr, pStyle);
      }
    }
    pStyle = paragraphStyleFrom(pPr, pStyle);
    // Absatzmarke: Schrift für leere Absätze
    pStyle.run = runStyleFrom(child(pPr, 'w:rPr'), rStyle, this.theme);
    const blocks: Block[] = [];
    const inlines: Inline[] = [];
    // Seitenumbruch mitten im Absatz: bisherigen Text als eigenen Absatz abschließen (dasselbe Feld wird weiter befüllt)
    const flushPageBreak = () => {
      blocks.push(paragraph(inlines.splice(0), pStyle, { ...(marker !== undefined ? { marker } : {}), ...(heading ? { heading } : {}) }));
      blocks.push({ kind: 'pageBreak' });
      marker = undefined;
      pStyle = { ...pStyle, pageBreakBefore: false, indentFirst: pStyle.indentFirst !== undefined && pStyle.indentFirst < 0 ? undefined : pStyle.indentFirst };
    };
    const heading = this.headingLevel(styleId, pPr);
    this.inlines(node, rStyle, undefined, inlines, flushPageBreak);
    blocks.push(paragraph(inlines, pStyle, { ...(marker !== undefined ? { marker } : {}), ...(heading ? { heading } : {}) }));
    return blocks;
  }

  private inlines(container: XmlElement, base: RunStyle, link: string | undefined, out: Inline[], pageBreak: () => void): void {
    for (const node of elements(container)) {
      switch (node.name) {
        case 'w:r':
          this.run(node, base, link, out, pageBreak);
          break;
        case 'w:hyperlink': {
          const rel = this.rels.get(node.attrs['r:id'] ?? '');
          this.inlines(node, base, rel?.external ? rel.target : link, out, pageBreak);
          break;
        }
        case 'w:ins':
        case 'w:smartTag':
        case 'w:customXml':
        case 'w:fldSimple':
        case 'w:bdo':
        case 'w:dir':
          this.inlines(node, base, link, out, pageBreak);
          break;
        case 'w:sdt':
          this.inlines(child(node, 'w:sdtContent') ?? node, base, link, out, pageBreak);
          break;
      }
    }
  }

  private run(node: XmlElement, base: RunStyle, link: string | undefined, out: Inline[], pageBreak: () => void): void {
    const rPr = child(node, 'w:rPr');
    if (toggle(child(rPr, 'w:vanish'))) return;
    let style = base;
    for (const charStyle of this.styleChain(attr(child(rPr, 'w:rStyle'), 'val'))) style = runStyleFrom(charStyle.rPr, style, this.theme);
    style = runStyleFrom(rPr, style, this.theme);
    // Links bekommen keine eigene Farbe, wenn das Dokument keine vorgibt
    const push = (value: string) => {
      const last = out[out.length - 1];
      if (last?.kind === 'text' && last.link === link && JSON.stringify(last.style) === JSON.stringify(style)) last.text += value;
      else out.push({ kind: 'text', text: value, style, ...(link ? { link } : {}) });
    };
    for (const item of elements(node)) {
      switch (item.name) {
        case 'w:t':
          push(textContent(item));
          break;
        case 'w:tab':
        case 'w:ptab':
          out.push({ kind: 'tab' });
          break;
        case 'w:br':
        case 'w:cr':
          if (attr(item, 'type') === 'page') pageBreak();
          else out.push({ kind: 'break' });
          break;
        case 'w:noBreakHyphen':
          push('‑');
          break;
        case 'w:softHyphen':
          push('­');
          break;
        case 'w:sym': {
          const code = Number.parseInt(attr(item, 'char') ?? '', 16);
          if (Number.isFinite(code)) push(bulletChar(String.fromCharCode(code), attr(item, 'font')));
          break;
        }
        case 'w:drawing': {
          const blip = find(item, 'a:blip');
          const extent = find(item, 'wp:extent');
          const src = this.image(blip?.attrs['r:embed']);
          const description = find(item, 'wp:docPr')?.attrs.descr;
          if (src)
            out.push({ kind: 'image', src, width: extent ? emuToPt(Number(extent.attrs.cx)) : null, height: extent ? emuToPt(Number(extent.attrs.cy)) : null, ...(description ? { alt: description } : {}) });
          break;
        }
        case 'w:pict':
        case 'w:object': {
          const image = find(item, 'v:imagedata');
          const src = this.image(image?.attrs['r:id']);
          const shapeStyle = find(item, 'v:shape')?.attrs.style ?? '';
          const width = /width:([\d.]+)pt/.exec(shapeStyle)?.[1];
          const height = /height:([\d.]+)pt/.exec(shapeStyle)?.[1];
          if (src) out.push({ kind: 'image', src, width: width ? Number(width) : null, height: height ? Number(height) : null });
          break;
        }
        case 'w:footnoteReference': {
          const note = this.footnotes.get(attr(item, 'id') ?? '');
          if (note) {
            this.notes.push(this.blocks(note));
            out.push({ kind: 'text', text: String(this.notes.length), style: { ...style, vertical: 'super' } });
          }
          break;
        }
      }
    }
  }

  private table(node: XmlElement): Block {
    const tblPr = child(node, 'w:tblPr');
    const styleId = attr(child(tblPr, 'w:tblStyle'), 'val');
    const styleBorders = this.styleChain(styleId).some((style) => hasBorders(child(style.tblPr, 'w:tblBorders')));
    const ownBorders = child(tblPr, 'w:tblBorders');
    const borders = ownBorders ? hasBorders(ownBorders) : styleBorders || /grid|gitter|raster/i.test(styleId ?? '');
    const columnWidths = childrenNamed(child(node, 'w:tblGrid'), 'w:gridCol').map((col) => twipsToPt(num(attr(col, 'w')) ?? 0));
    // Raster: je Zeile die Zellen mit Startspalte, um senkrecht verbundene Zellen zusammenzuführen
    const grid: Array<Array<{ cell: TableCell; column: number; merge: 'restart' | 'continue' | null }>> = [];
    for (const tr of childrenNamed(node, 'w:tr')) {
      const header = toggle(child(child(tr, 'w:trPr'), 'w:tblHeader')) === true;
      const row: Array<{ cell: TableCell; column: number; merge: 'restart' | 'continue' | null }> = [];
      let column = num(attr(child(child(tr, 'w:trPr'), 'w:gridBefore'), 'val')) ?? 0;
      for (const tc of childrenNamed(tr, 'w:tc')) {
        const tcPr = child(tc, 'w:tcPr');
        const span = num(attr(child(tcPr, 'w:gridSpan'), 'val')) ?? 1;
        const vMerge = child(tcPr, 'w:vMerge');
        const merge = vMerge ? (attr(vMerge, 'val') === 'restart' ? 'restart' : 'continue') : null;
        const background = normalizeColor(attr(child(tcPr, 'w:shd'), 'fill'));
        row.push({ cell: { blocks: this.blocks(tc), colSpan: span, rowSpan: 1, ...(background ? { background } : {}), ...(header ? { header } : {}) }, column, merge });
        column += span;
      }
      grid.push(row);
    }
    const rows = grid.map((row, r) =>
      row
        .filter((entry) => {
          if (entry.merge !== 'continue') return true;
          // Fortsetzung: der Zelle darüber eine Zeile mehr geben
          for (let above = r - 1; above >= 0; above--) {
            const owner = grid[above]?.find((candidate) => candidate.column === entry.column);
            if (!owner) break;
            if (owner.merge !== 'continue') {
              owner.cell.rowSpan++;
              break;
            }
          }
          return false;
        })
        .map((entry) => entry.cell),
    );
    return { kind: 'table', rows, borders, ...(columnWidths.length > 0 && columnWidths.every((w) => w > 0) ? { columnWidths } : {}) };
  }
}

const hasBorders = (borders: XmlElement | undefined): boolean => elements(borders).some((border) => !['none', 'nil'].includes(attr(border, 'val') ?? 'none'));

export function convertDocx(zip: ZipArchive): DocumentModel {
  // Hauptteil aus [Content_Types] bzw. _rels/.rels
  const rootRels = readRels(zip, '_rels/.rels');
  let documentPath = 'word/document.xml';
  for (const rel of rootRels.values()) if (/document\.xml$/i.test(rel.target)) documentPath = resolvePath('', rel.target);
  const source = zip.text(documentPath);
  if (!source) throw new Error('kein Word-Dokument');
  const reader = new DocxReader(zip, documentPath);
  const body = child(child(parseXml(source), 'w:document'), 'w:body');
  const blocks = reader.blocks(body);
  const sectPr = child(body, 'w:sectPr');
  const size = child(sectPr, 'w:pgSz');
  const margins = child(sectPr, 'w:pgMar');
  const twips = (node: XmlElement | undefined, name: string, fallback: number) => {
    const value = num(attr(node, name));
    return value !== undefined ? Math.abs(twipsToPt(value)) : fallback;
  };
  const page = {
    width: twips(size, 'w', DEFAULT_PAGE.width),
    height: twips(size, 'h', DEFAULT_PAGE.height),
    margins: {
      top: twips(margins, 'top', DEFAULT_PAGE.margins.top),
      right: twips(margins, 'right', DEFAULT_PAGE.margins.right),
      bottom: twips(margins, 'bottom', DEFAULT_PAGE.margins.bottom),
      left: twips(margins, 'left', DEFAULT_PAGE.margins.left),
    },
  };
  const core = zip.text('docProps/core.xml');
  const title = core ? textContent(find(parseXml(core), 'dc:title')).trim() || null : null;
  return { title, lang: reader.lang, page, font: reader.defaultRun.font ?? null, size: reader.defaultRun.size ?? 10, blocks, notes: reader.notes };
}
