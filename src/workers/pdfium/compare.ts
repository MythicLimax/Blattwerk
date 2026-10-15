// Vergleichsbericht (Phase 6, ADR 0014) mit @cantoo/pdf-lib: Übersicht, danach je Seitenpaar mit Änderungen die alte
// und die neue Seite nebeneinander. Entfernte Wörter sind links rot, neue rechts grün markiert. Erwartet
// unverschlüsselte Dokumente (PDFium entfernt vorher einen Schutz, nur für den Bericht).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { Rect } from '../../shared/annotations';
import { compareKey, diffWords, type CompareLabels, type ComparePageResult, type PageWord } from '../../shared/compare';
import { isWinAnsi } from '../../shared/content';

export interface CompareInput {
  oldBytes: Uint8Array;
  newBytes: Uint8Array;
  // Wörter je Seite
  oldWords: PageWord[][];
  newWords: PageWord[][];
  names: { old: string; new: string };
  labels: CompareLabels;
}

const RED = rgb(0.86, 0.15, 0.15);
const GREEN = rgb(0.1, 0.62, 0.25);
const LANDSCAPE: [number, number] = [842, 595];
const PORTRAIT: [number, number] = [595, 842];
const MARGIN = 36;

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
// Standardschrift: nur westeuropäische Zeichen; andere werden ersetzt
const safe = (text: string) => [...text].map((char) => (isWinAnsi(char) ? char : '?')).join('');

// Zeilenumbruch für die Übersicht
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of safe(text).split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

export interface CompareReport {
  bytes: Uint8Array;
  pages: ComparePageResult[];
}

export async function buildCompareReport(input: CompareInput): Promise<CompareReport> {
  const { labels } = input;
  const report = await PDFDocument.create();
  report.setTitle(safe(`${labels.title}: ${input.names.old} – ${input.names.new}`));
  const font = await report.embedFont(StandardFonts.Helvetica);
  const bold = await report.embedFont(StandardFonts.HelveticaBold);
  const oldDoc = await PDFDocument.load(input.oldBytes, { updateMetadata: false, throwOnInvalidObject: false });
  const newDoc = await PDFDocument.load(input.newBytes, { updateMetadata: false, throwOnInvalidObject: false });

  // Seitenpaare nach Reihenfolge; überzählige Seiten gelten als entfernt bzw. neu
  const count = Math.max(input.oldWords.length, input.newWords.length);
  const results: ComparePageResult[] = [];
  const marks: Array<{ removed: Rect[]; added: Rect[] }> = [];
  for (let i = 0; i < count; i++) {
    const a = input.oldWords[i];
    const b = input.newWords[i];
    const diff = diffWords((a ?? []).map((word) => compareKey(word.text)), (b ?? []).map((word) => compareKey(word.text)));
    const removed = diff.removed.map((index) => a?.[index] as PageWord);
    const added = diff.added.map((index) => b?.[index] as PageWord);
    const changed = removed.length > 0 || added.length > 0 || !a || !b;
    marks.push({ removed: removed.map((word) => word.rect), added: added.map((word) => word.rect) });
    if (!changed) continue;
    const sample = [removed.length > 0 ? `– ${removed.slice(0, 6).map((word) => word.text).join(' ')}` : '', added.length > 0 ? `+ ${added.slice(0, 6).map((word) => word.text).join(' ')}` : '']
      .filter(Boolean)
      .join('   ');
    results.push({ oldPage: a ? i + 1 : null, newPage: b ? i + 1 : null, removed: removed.length, added: added.length, sample });
  }

  // Übersicht
  let page = report.addPage(PORTRAIT);
  let y = PORTRAIT[1] - MARGIN;
  const line = (text: string, size: number, useFont = font, color = rgb(0, 0, 0)) => {
    for (const part of wrap(text, useFont, size, PORTRAIT[0] - 2 * MARGIN)) {
      if (y < MARGIN + size) {
        page = report.addPage(PORTRAIT);
        y = PORTRAIT[1] - MARGIN;
      }
      y -= size * 1.25;
      page.drawText(part, { x: MARGIN, y, size, font: useFont, color });
    }
  };
  line(labels.title, 20, bold);
  y -= 6;
  line(`${labels.oldFile}: ${input.names.old} (${oldDoc.getPageCount()})`, 11);
  line(`${labels.newFile}: ${input.names.new} (${newDoc.getPageCount()})`, 11);
  y -= 8;
  const totalRemoved = results.reduce((sum, result) => sum + result.removed, 0);
  const totalAdded = results.reduce((sum, result) => sum + result.added, 0);
  line(results.length === 0 ? labels.noChanges : fill(labels.summary, { pages: results.length, removed: totalRemoved, added: totalAdded }), 12, bold);
  line(labels.legend, 9, font, rgb(0.35, 0.35, 0.35));
  y -= 6;
  for (const result of results) {
    const head =
      result.oldPage === null
        ? fill(labels.pagesAdded, { page: result.newPage ?? 0 })
        : result.newPage === null
          ? fill(labels.pagesRemoved, { page: result.oldPage })
          : fill(labels.pageLine, { page: result.oldPage, removed: result.removed, added: result.added });
    line(head, 11, bold);
    if (result.sample) line(result.sample, 9, font, rgb(0.3, 0.3, 0.3));
    y -= 4;
  }

  // Seitenpaare mit Änderungen nebeneinander
  const paneWidth = (LANDSCAPE[0] - 3 * MARGIN) / 2;
  const paneHeight = LANDSCAPE[1] - 2 * MARGIN - 24;
  const drawPane = async (target: PDFPage, source: PDFDocument, index: number | null, x: number, rects: Rect[], color: typeof RED, caption: string) => {
    target.drawText(safe(caption), { x, y: LANDSCAPE[1] - MARGIN - 12, size: 10, font: bold });
    if (index === null) {
      target.drawText(safe(labels.noPage), { x, y: LANDSCAPE[1] / 2, size: 12, font, color: rgb(0.45, 0.45, 0.45) });
      return;
    }
    const sourcePage = source.getPage(index);
    const box = sourcePage.getMediaBox();
    const [embedded] = await report.embedPages([sourcePage]);
    if (!embedded) return;
    const scale = Math.min(paneWidth / box.width, paneHeight / box.height);
    const top = LANDSCAPE[1] - MARGIN - 24;
    const originY = top - box.height * scale;
    target.drawRectangle({ x: x - 0.5, y: originY - 0.5, width: box.width * scale + 1, height: box.height * scale + 1, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    target.drawPage(embedded, { x, y: originY, xScale: scale, yScale: scale });
    for (const [l, b, r, t] of rects) {
      target.drawRectangle({
        x: x + (l - box.x) * scale - 1,
        y: originY + (b - box.y) * scale - 1,
        width: (r - l) * scale + 2,
        height: (t - b) * scale + 2,
        color,
        opacity: 0.3,
        borderColor: color,
        borderWidth: 0.6,
      });
    }
  };
  for (const result of results) {
    const index = (result.oldPage ?? result.newPage ?? 1) - 1;
    const pair = marks[index] ?? { removed: [], added: [] };
    const target = report.addPage(LANDSCAPE);
    const page = labels.page;
    await drawPane(target, oldDoc, result.oldPage === null ? null : index, MARGIN, pair.removed, RED, `${labels.oldFile} – ${page} ${result.oldPage ?? ''}`);
    await drawPane(target, newDoc, result.newPage === null ? null : index, 2 * MARGIN + paneWidth, pair.added, GREEN, `${labels.newFile} – ${page} ${result.newPage ?? ''}`);
  }
  return { bytes: await report.save({ useObjectStreams: true }), pages: results };
}
