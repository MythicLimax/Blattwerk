// Dokumentmodell → HTML für den Satz durch Chromium. Alle Texte werden maskiert; Bilder nur als data:-URL, Links nur
// http, https und mailto. Die Seite lädt nichts nach und führt kein Skript aus (CSP und abgeschaltetes JavaScript).
import type { Block, DocumentModel, Inline, Paragraph, ParagraphStyle, RunStyle, Table } from './model';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pt = (value: number) => `${Math.round(value * 100) / 100}pt`;

// Schriftname → CSS-Schriftliste mit passendem Ersatz (Office-Schriften fehlen auf dem Mac oft)
export function fontStack(font: string | null | undefined): string {
  const generic = !font
    ? 'sans'
    : /courier|consolas|mono|menlo|code|typewriter/i.test(font)
      ? 'mono'
      : /times|cambria|georgia|garamond|book|serif|palatino|baskerville|minion|liberation serif|roman|didot/i.test(font) && !/sans/i.test(font)
        ? 'serif'
        : 'sans';
  const fallback =
    generic === 'mono' ? '"Menlo", "Consolas", "Courier New", monospace' : generic === 'serif' ? '"Times New Roman", "Times", "Georgia", serif' : '"Helvetica Neue", "Arial", "Helvetica", sans-serif';
  const own = font ? `"${font.replace(/["\\<>;{}]/g, '')}", ` : '';
  return own + fallback;
}

function runCss(style: RunStyle): string {
  const css: string[] = [];
  if (style.bold) css.push('font-weight:bold');
  if (style.italic) css.push('font-style:italic');
  const decorations = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean);
  if (decorations.length > 0) css.push(`text-decoration:${decorations.join(' ')}`);
  if (style.color) css.push(`color:${style.color}`);
  if (style.background) css.push(`background:${style.background}`);
  if (style.size) css.push(`font-size:${pt(style.vertical ? style.size * 0.66 : style.size)}`);
  else if (style.vertical) css.push('font-size:66%');
  if (style.font) css.push(`font-family:${fontStack(style.font)}`);
  if (style.vertical) css.push(`vertical-align:${style.vertical === 'super' ? 'super' : 'sub'}`, 'line-height:0');
  if (style.smallCaps) css.push('font-variant:small-caps');
  if (style.caps) css.push('text-transform:uppercase');
  return css.join(';');
}

function safeLink(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null;
}

function inlineHtml(inline: Inline): string {
  switch (inline.kind) {
    case 'break':
      return '<br>';
    case 'tab':
      return '<span class="tab"></span>';
    case 'image': {
      if (!/^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(inline.src)) return '';
      const size = [inline.width ? `width:${pt(inline.width)}` : '', inline.height ? `height:${pt(inline.height)}` : ''].filter(Boolean).join(';');
      return `<img src="${inline.src}" alt="${escape(inline.alt ?? '')}" style="${size}">`;
    }
    case 'text': {
      if (inline.text === '') return '';
      const css = runCss(inline.style);
      const content = css ? `<span style="${css}">${escape(inline.text)}</span>` : escape(inline.text);
      const href = inline.link ? safeLink(inline.link) : null;
      return href ? `<a href="${escape(href)}">${content}</a>` : content;
    }
  }
}

function paragraphCss(style: ParagraphStyle, marker: boolean): string {
  const css: string[] = [];
  if (style.align) css.push(`text-align:${style.align}`);
  const first = style.indentFirst ?? (marker ? -18 : 0);
  const left = (style.indentLeft ?? 0) + (marker && style.indentFirst === undefined ? 18 : 0);
  if (left) css.push(`padding-left:${pt(left)}`);
  if (style.indentRight) css.push(`padding-right:${pt(style.indentRight)}`);
  if (first) css.push(`text-indent:${pt(first)}`);
  if (style.spaceBefore) css.push(`margin-top:${pt(style.spaceBefore)}`);
  if (style.spaceAfter) css.push(`margin-bottom:${pt(style.spaceAfter)}`);
  if (style.lineHeight) css.push(`line-height:${'multiple' in style.lineHeight ? Math.max(0.5, style.lineHeight.multiple * 1.17).toFixed(3) : pt(style.lineHeight.exact)}`);
  if (style.pageBreakBefore) css.push('break-before:page');
  if (style.background) css.push(`background:${style.background}`);
  if (style.run) {
    const run = runCss({ ...style.run, vertical: undefined });
    if (run) css.push(run);
  }
  return css.join(';');
}

function paragraphHtml(p: Paragraph): string {
  const tag = p.heading ? `h${Math.min(6, Math.max(1, p.heading))}` : p.preformatted ? 'pre' : 'p';
  const css = paragraphCss(p.style, p.marker !== undefined);
  const first = p.style.indentFirst ?? -18;
  const marker = p.marker !== undefined ? `<span class="mk" style="min-width:${pt(Math.max(0, -first))}">${escape(p.marker)}</span>` : '';
  const content = p.inlines.map(inlineHtml).join('');
  // Leere Absätze behalten ihre Höhe
  const body = content.replace(/<[^>]+>/g, '').length > 0 || /<img/.test(content) ? content : '<br>';
  return `<${tag}${css ? ` style="${css}"` : ''}>${marker}${body}</${tag}>`;
}

function tableHtml(table: Table): string {
  const total = table.columnWidths?.reduce((a, b) => a + b, 0) ?? 0;
  const cols = table.columnWidths && total > 0 ? `<colgroup>${table.columnWidths.map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%">`).join('')}</colgroup>` : '';
  const rows = table.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const tag = cell.header ? 'th' : 'td';
          const css = [table.borders ? 'border:0.75pt solid #000' : '', cell.background ? `background:${cell.background}` : ''].filter(Boolean).join(';');
          const span = `${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}`;
          return `<${tag}${span}${css ? ` style="${css}"` : ''}>${blocksHtml(cell.blocks)}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table${total > 0 ? ' class="fixed"' : ''}>${cols}${rows}</table>`;
}

function blocksHtml(blocks: Block[]): string {
  return blocks.map((block) => (block.kind === 'paragraph' ? paragraphHtml(block) : block.kind === 'table' ? tableHtml(block) : '<div class="pb"></div>')).join('\n');
}

export function documentHtml(model: DocumentModel): string {
  const { page } = model;
  const notes =
    model.notes.length > 0
      ? `<section class="notes"><hr>${model.notes.map((note, i) => `<div class="note"><span class="nn">${i + 1}</span>${blocksHtml(note)}</div>`).join('')}</section>`
      : '';
  return `<!doctype html>
<html${model.lang ? ` lang="${escape(model.lang)}"` : ''}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escape(model.title ?? '')}</title>
<style>
@page { size: ${pt(page.width)} ${pt(page.height)}; margin: ${pt(page.margins.top)} ${pt(page.margins.right)} ${pt(page.margins.bottom)} ${pt(page.margins.left)}; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: ${fontStack(model.font)}; font-size: ${pt(model.size)}; line-height: 1.17; color: #000; hyphens: manual; overflow-wrap: break-word; }
p, h1, h2, h3, h4, h5, h6, pre { margin: 0; white-space: pre-wrap; tab-size: 4; font-size: inherit; font-weight: inherit; }
pre { font-family: ${fontStack('Menlo')}; font-size: 0.9em; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
.mk { display: inline-block; box-sizing: border-box; padding-right: 0.3em; text-indent: 0; white-space: pre; }
.tab { display: inline-block; width: 36pt; }
img { max-width: 100%; vertical-align: bottom; }
a { color: inherit; }
table { border-collapse: collapse; margin: 0 0 6pt; max-width: 100%; }
table.fixed { width: 100%; table-layout: fixed; }
td, th { padding: 2pt 5pt; vertical-align: top; text-align: left; font-weight: inherit; overflow-wrap: break-word; }
tr { break-inside: avoid; }
.pb { break-after: page; height: 0; }
.notes { margin-top: 18pt; font-size: 0.85em; }
.notes hr { width: 33%; margin: 0 0 6pt; border: none; border-top: 0.75pt solid #000; }
.note { display: flex; gap: 4pt; }
.nn { vertical-align: super; font-size: 0.7em; }
</style>
</head>
<body>
${blocksHtml(model.blocks)}
${notes}
</body>
</html>`;
}
