// Reiner Text (.txt) und Markdown (.md) → Dokumentmodell.
import { DEFAULT_PAGE, paragraph, text, type Block, type DocumentModel, type Inline, type RunStyle } from './model';

// UTF-8 (mit oder ohne BOM), UTF-16 mit BOM, sonst Windows-1252
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const base = (blocks: Block[], title: string | null, font: string | null): DocumentModel => ({ title, lang: null, page: DEFAULT_PAGE, font, size: 11, blocks, notes: [] });

export function convertText(bytes: Uint8Array): DocumentModel {
  const lines = decodeText(bytes).replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const blocks: Block[] = lines.map((line) =>
    line.includes('\f') ? { kind: 'pageBreak' as const } : paragraph(line ? [text(line.replace(/\t/g, '    '))] : [], {}, { preformatted: true }),
  );
  return base(blocks, null, 'Menlo');
}

// Fett, kursiv, Code und Links innerhalb einer Zeile
function markdownInlines(source: string, style: RunStyle = {}): Inline[] {
  const out: Inline[] = [];
  const pattern = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|~~(.+?)~~/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > last) out.push(text(source.slice(last, match.index), style));
    if (match[2] !== undefined) out.push(...markdownInlines(match[2], { ...style, bold: true }));
    else if (match[4] !== undefined) out.push(...markdownInlines(match[4], { ...style, italic: true }));
    else if (match[5] !== undefined) out.push(text(match[5], { ...style, font: 'Menlo', background: '#f0f0f0' }));
    else if (match[6] !== undefined) out.push(...markdownInlines(match[6], { ...style, color: '#1a4fb4', underline: true }).map((inline) => (inline.kind === 'text' ? { ...inline, link: match?.[7] } : inline)));
    else if (match[8] !== undefined) out.push(...markdownInlines(match[8], { ...style, strike: true }));
    last = match.index + match[0].length;
  }
  if (last < source.length) out.push(text(source.slice(last), style));
  return out;
}

const HEADING_SIZES = [22, 18, 15, 13, 12, 11];

export function convertMarkdown(bytes: Uint8Array): DocumentModel {
  const lines = decodeText(bytes).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let title: string | null = null;
  const counters: number[] = [];
  const flush = () => {
    if (buffer.length > 0) blocks.push(paragraph(markdownInlines(buffer.join(' ')), { spaceAfter: 8 }));
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = /^(```|~~~)/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] as string).startsWith(fence[1] as string); i++) code.push(lines[i] as string);
      blocks.push(paragraph([text(code.join('\n'))], { background: '#f4f4f4', spaceAfter: 8 }, { preformatted: true }));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    const table = /^\s*\|(.+)\|\s*$/.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] as string).length;
      if (level === 1 && !title) title = heading[2] ?? null;
      blocks.push(paragraph(markdownInlines(heading[2] as string, { bold: true, size: HEADING_SIZES[level - 1] }), { spaceBefore: level <= 2 ? 14 : 10, spaceAfter: 6 }, { heading: level }));
    } else if (bullet || numbered) {
      flush();
      const indent = Math.floor(((bullet?.[1] ?? numbered?.[1] ?? '') as string).replace(/\t/g, '    ').length / 2);
      counters.length = indent + 1;
      const marker = bullet ? (indent % 2 === 0 ? '•' : '◦') : `${(counters[indent] = (counters[indent] ?? 0) + 1)}.`;
      if (bullet) counters[indent] = 0;
      blocks.push(paragraph(markdownInlines((bullet?.[2] ?? numbered?.[3]) as string), { indentLeft: 18 * (indent + 1), indentFirst: -18, spaceAfter: 3 }, { marker }));
    } else if (table) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i] as string); i++) {
        const cells = (lines[i] as string).trim().slice(1, -1).split('|').map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
      }
      i--;
      blocks.push({
        kind: 'table',
        borders: true,
        rows: rows.map((cells, r) => cells.map((cell) => ({ blocks: [paragraph(markdownInlines(cell, r === 0 ? { bold: true } : {}))], colSpan: 1, rowSpan: 1, ...(r === 0 ? { header: true } : {}) }))),
      });
    } else if (/^\s*>\s?/.test(line)) {
      flush();
      blocks.push(paragraph(markdownInlines(line.replace(/^\s*>\s?/, ''), { italic: true, color: '#555555' }), { indentLeft: 18, spaceAfter: 6 }));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push(paragraph([text('—'.repeat(3), { color: '#999999' })], { align: 'center', spaceAfter: 8 }));
    } else if (line.trim() === '') {
      flush();
      counters.length = 0;
    } else {
      buffer.push(line.trim());
    }
  }
  flush();
  return base(blocks, title, null);
}
