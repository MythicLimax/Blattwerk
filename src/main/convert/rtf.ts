// RTF (TextEdit, WordPad, ältere Word-Versionen) → Dokumentmodell. Übernimmt Schriften, Größen, Farben, Fett/Kursiv/
// Unterstrichen, Ausrichtung, Einzüge, Abstände, Seitenformat, Bilder (PNG, JPEG), Links und einfache Tabellen.
import { DEFAULT_PAGE, twipsToPt, type Block, type DocumentModel, type Inline, type ParagraphStyle, type RunStyle, type TableCell } from './model';

// Windows-1252: Zeichen 0x80–0x9F
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};
// Mac Roman: Zeichen 0x80–0xFF (TextEdit nutzt meist \ansicpg1252, ältere Dateien \mac)
const MAC_ROMAN = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

// Ziele, deren Inhalt nicht im Text erscheint
const SKIPPED = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'pnseclvl', 'listtable', 'listoverridetable',
  'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'object', 'expandedcolortbl', 'filetbl', 'revtbl', 'pgdsctbl',
  'bkmkstart', 'bkmkend', 'nonshppict', 'footnote', 'annotation', 'atnid', 'atnauthor', 'xe', 'tc',
]);

interface State {
  run: RunStyle;
  font: number | null;
  skip: boolean;
  // Unicode-Ersatzzeichen nach \u
  uc: number;
  destination: string | null;
}

interface Token {
  type: 'open' | 'close' | 'word' | 'text' | 'hex';
  word?: string;
  param?: number;
  text?: string;
}

function* tokenize(source: string): Generator<Token> {
  let i = 0;
  while (i < source.length) {
    const c = source[i] as string;
    if (c === '{') {
      yield { type: 'open' };
      i++;
    } else if (c === '}') {
      yield { type: 'close' };
      i++;
    } else if (c === '\\') {
      const next = source[i + 1] ?? '';
      if (/[a-zA-Z]/.test(next)) {
        const match = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(source.slice(i + 1, i + 50)) as RegExpExecArray;
        yield { type: 'word', word: match[1], ...(match[2] !== undefined ? { param: Number(match[2]) } : {}) };
        i += 1 + match[0].length;
      } else if (next === "'") {
        yield { type: 'hex', param: Number.parseInt(source.slice(i + 2, i + 4), 16) };
        i += 4;
      } else if (next === '\n' || next === '\r') {
        yield { type: 'word', word: 'par' };
        i += 2;
      } else {
        // Steuerzeichen: \~ geschütztes Leerzeichen, \- weicher Trennstrich, \_ geschützter Bindestrich, \* Ziel
        const symbols: Record<string, Token> = { '~': { type: 'text', text: ' ' }, '-': { type: 'text', text: '­' }, _: { type: 'text', text: '‑' }, '*': { type: 'word', word: '*' } };
        yield symbols[next] ?? { type: 'text', text: next };
        i += 2;
      }
    } else if (c === '\r' || c === '\n') {
      i++;
    } else {
      let j = i;
      while (j < source.length && !'{}\\\r\n'.includes(source[j] as string)) j++;
      yield { type: 'text', text: source.slice(i, j) };
      i = j;
    }
  }
}

export function convertRtf(bytes: Uint8Array): DocumentModel {
  const source = new TextDecoder('latin1').decode(bytes);
  if (!source.startsWith('{\\rtf')) throw new Error('keine RTF-Datei');
  const fonts = new Map<number, string>();
  const colors: Array<string | undefined> = [];
  let mac = false;
  const page = { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } };
  let title: string | null = null;
  let defaultFont: number | null = null;

  const blocks: Block[] = [];
  let paragraphStyle: ParagraphStyle = {};
  let inlines: Inline[] = [];
  let link: string | null = null;
  let fieldInstruction = '';
  // Tabelle im Aufbau
  let rowCells: TableCell[] = [];
  let cellBlocks: Block[] = [];
  let rows: TableCell[][] = [];
  // Der aktuelle Absatz steht in einer Tabellenzelle (\\intbl bis \\pard)
  let paragraphInTable = false;
  let picture: { hex: string[]; type: string | null; width: number | null; height: number | null; goalWidth: number | null; goalHeight: number | null } | null = null;
  let fontEntry = '';
  let fontEntryNumber: number | null = null;
  let color = { r: 0, g: 0, b: 0, set: false };
  let infoTitle = '';

  const stack: State[] = [];
  let state: State = { run: {}, font: null, skip: false, uc: 1, destination: null };
  let skipChars = 0;
  let pendingDestination = false;

  const finishTable = () => {
    if (rowCells.length > 0) rows.push(rowCells);
    if (rows.length > 0) blocks.push({ kind: 'table', rows, borders: true });
    rows = [];
    rowCells = [];
  };
  const finishParagraph = () => {
    const block: Block = { kind: 'paragraph', style: paragraphStyle, inlines };
    inlines = [];
    if (paragraphInTable) {
      cellBlocks.push(block);
      return;
    }
    if (rows.length > 0 || rowCells.length > 0) finishTable();
    blocks.push(block);
  };
  const runStyle = (): RunStyle => {
    const font = state.font ?? defaultFont;
    const name = font !== null ? fonts.get(font) : undefined;
    return { ...state.run, ...(name ? { font: name } : {}) };
  };
  const addText = (value: string) => {
    if (state.destination === 'fldinst') {
      fieldInstruction += value;
      return;
    }
    if (state.destination === 'fonttbl') {
      fontEntry += value;
      return;
    }
    if (state.destination === 'title') {
      infoTitle += value;
      return;
    }
    if (state.destination === 'colortbl') {
      if (value.includes(';')) {
        colors.push(color.set ? `#${[color.r, color.g, color.b].map((n) => n.toString(16).padStart(2, '0')).join('')}` : undefined);
        color = { r: 0, g: 0, b: 0, set: false };
      }
      return;
    }
    if (state.destination === 'pict') {
      picture?.hex.push(value.replace(/[^0-9a-fA-F]/g, ''));
      return;
    }
    if (state.skip) return;
    const style = runStyle();
    const last = inlines[inlines.length - 1];
    if (last?.kind === 'text' && JSON.stringify(last.style) === JSON.stringify(style) && (last.link ?? null) === link) last.text += value;
    else inlines.push({ kind: 'text', text: value, style, ...(link ? { link } : {}) });
  };
  const decodeByte = (code: number) => (mac && code >= 0x80 ? (MAC_ROMAN[code - 0x80] ?? '') : String.fromCharCode(CP1252[code] ?? code));

  for (const token of tokenize(source)) {
    if (token.type === 'open') {
      stack.push(state);
      state = { ...state, run: { ...state.run } };
      pendingDestination = false;
      continue;
    }
    if (token.type === 'close') {
      const closing = state;
      if (closing.destination === 'fonttbl' && fontEntryNumber !== null && fontEntry) {
        fonts.set(fontEntryNumber, fontEntry.replace(/;.*$/, '').trim());
        fontEntry = '';
      }
      if (closing.destination === 'pict' && picture && (stack[stack.length - 1]?.destination !== 'pict')) {
        const hex = picture.hex.join('');
        if (picture.type && hex.length > 0 && hex.length % 2 === 0) {
          const data = Buffer.from(hex, 'hex').toString('base64');
          const width = picture.goalWidth ? twipsToPt(picture.goalWidth) : null;
          const height = picture.goalHeight ? twipsToPt(picture.goalHeight) : null;
          const scaleX = picture.width ?? 100;
          const scaleY = picture.height ?? 100;
          inlines.push({ kind: 'image', src: `data:${picture.type};base64,${data}`, width: width ? (width * scaleX) / 100 : null, height: height ? (height * scaleY) / 100 : null });
        }
        picture = null;
      }
      if (closing.destination === 'fldinst') {
        const match = /HYPERLINK\s+"([^"]+)"/.exec(fieldInstruction);
        link = match?.[1] ?? null;
        fieldInstruction = '';
      }
      if (closing.destination === 'fldrslt') link = null;
      if (closing.destination === 'title') title = infoTitle.trim() || null;
      state = stack.pop() ?? state;
      continue;
    }
    if (token.type === 'hex') {
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      addText(decodeByte(token.param ?? 0x3f));
      continue;
    }
    if (token.type === 'text') {
      let value = token.text ?? '';
      if (skipChars > 0) {
        const skip = Math.min(skipChars, value.length);
        value = value.slice(skip);
        skipChars -= skip;
      }
      if (value) addText(value);
      pendingDestination = false;
      continue;
    }
    const word = token.word as string;
    const param = token.param;
    if (word === '*') {
      pendingDestination = true;
      continue;
    }
    // Zielgruppe beginnt
    if (pendingDestination || SKIPPED.has(word) || ['fonttbl', 'colortbl', 'pict', 'fldinst', 'fldrslt', 'title', 'field'].includes(word)) {
      if (['fonttbl', 'colortbl', 'pict', 'fldinst', 'fldrslt', 'title', 'field'].includes(word)) {
        state.destination = word;
        if (word === 'pict') picture = { hex: [], type: null, width: null, height: null, goalWidth: null, goalHeight: null };
      } else if (pendingDestination || SKIPPED.has(word)) {
        state.skip = true;
        state.destination = word;
      }
      pendingDestination = false;
      if (['fonttbl', 'colortbl', 'pict', 'fldinst', 'title'].includes(word) || state.skip) continue;
    }
    if (state.destination === 'fonttbl' && word === 'f') {
      fontEntryNumber = param ?? 0;
      fontEntry = '';
      continue;
    }
    if (state.destination === 'colortbl') {
      if (word === 'red') color = { ...color, r: param ?? 0, set: true };
      if (word === 'green') color = { ...color, g: param ?? 0, set: true };
      if (word === 'blue') color = { ...color, b: param ?? 0, set: true };
      continue;
    }
    if (state.destination === 'pict' && picture) {
      if (word === 'pngblip') picture.type = 'image/png';
      else if (word === 'jpegblip') picture.type = 'image/jpeg';
      else if (word === 'picwgoal') picture.goalWidth = param ?? null;
      else if (word === 'pichgoal') picture.goalHeight = param ?? null;
      else if (word === 'picscalex') picture.width = param ?? null;
      else if (word === 'picscaley') picture.height = param ?? null;
      continue;
    }
    switch (word) {
      case 'mac':
        mac = true;
        break;
      case 'deff':
        defaultFont = param ?? 0;
        break;
      case 'paperw':
        page.width = twipsToPt(param ?? 11906);
        break;
      case 'paperh':
        page.height = twipsToPt(param ?? 16838);
        break;
      case 'margl':
        page.margins.left = twipsToPt(param ?? 1418);
        break;
      case 'margr':
        page.margins.right = twipsToPt(param ?? 1418);
        break;
      case 'margt':
        page.margins.top = twipsToPt(param ?? 1418);
        break;
      case 'margb':
        page.margins.bottom = twipsToPt(param ?? 1134);
        break;
      case 'uc':
        state.uc = param ?? 1;
        break;
      case 'u': {
        const code = (param ?? 63) < 0 ? (param as number) + 65536 : (param ?? 63);
        addText(String.fromCharCode(code));
        skipChars = state.uc;
        break;
      }
      case 'par':
      case 'sect':
        finishParagraph();
        break;
      case 'line':
        inlines.push({ kind: 'break' });
        break;
      case 'tab':
        inlines.push({ kind: 'tab' });
        break;
      case 'page':
        finishParagraph();
        if (!paragraphInTable) blocks.push({ kind: 'pageBreak' });
        break;
      case 'emdash':
        addText('—');
        break;
      case 'endash':
        addText('–');
        break;
      case 'bullet':
        addText('•');
        break;
      case 'lquote':
        addText('‘');
        break;
      case 'rquote':
        addText('’');
        break;
      case 'ldblquote':
        addText('“');
        break;
      case 'rdblquote':
        addText('”');
        break;
      case 'pard':
        paragraphStyle = {};
        paragraphInTable = false;
        break;
      case 'intbl':
        paragraphInTable = true;
        break;
      case 'cell':
      case 'nestcell':
        paragraphInTable = true;
        if (inlines.length > 0) finishParagraph();
        rowCells.push({ blocks: cellBlocks, colSpan: 1, rowSpan: 1 });
        cellBlocks = [];
        break;
      case 'row':
      case 'nestrow':
        rows.push(rowCells);
        rowCells = [];
        cellBlocks = [];
        break;
      case 'plain':
        state.run = {};
        state.font = null;
        break;
      case 'b':
        state.run.bold = param !== 0;
        break;
      case 'i':
        state.run.italic = param !== 0;
        break;
      case 'ul':
        state.run.underline = param !== 0;
        break;
      case 'ulnone':
        state.run.underline = false;
        break;
      case 'strike':
        state.run.strike = param !== 0;
        break;
      case 'super':
        state.run.vertical = 'super';
        break;
      case 'sub':
        state.run.vertical = 'sub';
        break;
      case 'nosupersub':
        delete state.run.vertical;
        break;
      case 'scaps':
        state.run.smallCaps = param !== 0;
        break;
      case 'caps':
        state.run.caps = param !== 0;
        break;
      case 'fs':
        state.run.size = (param ?? 24) / 2;
        break;
      case 'f':
        state.font = param ?? 0;
        break;
      case 'cf': {
        const value = colors[param ?? 0];
        if (value) state.run.color = value;
        else delete state.run.color;
        break;
      }
      case 'highlight':
      case 'cb': {
        const value = colors[param ?? 0];
        if (value && param) state.run.background = value;
        else delete state.run.background;
        break;
      }
      case 'ql':
        paragraphStyle = { ...paragraphStyle, align: 'left' };
        break;
      case 'qr':
        paragraphStyle = { ...paragraphStyle, align: 'right' };
        break;
      case 'qc':
        paragraphStyle = { ...paragraphStyle, align: 'center' };
        break;
      case 'qj':
        paragraphStyle = { ...paragraphStyle, align: 'justify' };
        break;
      case 'li':
        paragraphStyle = { ...paragraphStyle, indentLeft: twipsToPt(param ?? 0) };
        break;
      case 'ri':
        paragraphStyle = { ...paragraphStyle, indentRight: twipsToPt(param ?? 0) };
        break;
      case 'fi':
        paragraphStyle = { ...paragraphStyle, indentFirst: twipsToPt(param ?? 0) };
        break;
      case 'sb':
        paragraphStyle = { ...paragraphStyle, spaceBefore: twipsToPt(param ?? 0) };
        break;
      case 'sa':
        paragraphStyle = { ...paragraphStyle, spaceAfter: twipsToPt(param ?? 0) };
        break;
      case 'sl':
        if (param && param > 0) paragraphStyle = { ...paragraphStyle, lineHeight: { exact: twipsToPt(param) } };
        break;
      case 'pagebb':
        paragraphStyle = { ...paragraphStyle, pageBreakBefore: true };
        break;
    }
  }
  if (inlines.length > 0) finishParagraph();
  paragraphInTable = false;
  finishTable();
  // TextEdit schließt mit einem leeren Absatz; am Ende entfernen
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last?.kind === 'paragraph' && last.inlines.length === 0) blocks.pop();
    else break;
  }
  const firstFont = defaultFont !== null ? (fonts.get(defaultFont) ?? null) : null;
  return { title, lang: null, page, font: firstFont, size: 12, blocks, notes: [] };
}
