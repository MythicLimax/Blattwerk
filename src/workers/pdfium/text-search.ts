// Text im Dokument suchen und die genaue Lage jedes Treffers liefern (für „Suchen und schwärzen“, Phase 5).
// pdf.js kennt nur Textstücke; PDFium liefert die Rechtecke der einzelnen Treffer.
import type { Quad } from '../../shared/annotations';
import type { TextMatch, TextSearchOptions } from '../../shared/redaction';
import { withBuffer, withWString, type Pdfium } from './memory';

const MATCH_CASE = 1;
const MATCH_WHOLE_WORD = 2;
// Obergrenze, damit eine sehr häufige Zeichenfolge die Oberfläche nicht überflutet
export const MAX_TEXT_MATCHES = 2000;

function matchRects(m: Pdfium, textPage: number, start: number, count: number): Quad[] {
  const rects = m.FPDFText_CountRects(textPage, start, count);
  const quads: Quad[] = [];
  withBuffer(m, 32, (ptr) => {
    for (let i = 0; i < rects; i++) {
      if (!m.FPDFText_GetRect(textPage, i, ptr, ptr + 8, ptr + 16, ptr + 24)) continue;
      const value = (offset: number) => m.pdfium.getValue(ptr + offset, 'double') as number;
      const [left, top, right, bottom] = [value(0), value(8), value(16), value(24)];
      quads.push([
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom },
      ]);
    }
  });
  return quads;
}

export function findText(m: Pdfium, doc: number, options: TextSearchOptions): { matches: TextMatch[]; truncated: boolean } {
  const query = options.query.trim();
  const matches: TextMatch[] = [];
  if (!query) return { matches, truncated: false };
  const flags = (options.matchCase ? MATCH_CASE : 0) | (options.wholeWord ? MATCH_WHOLE_WORD : 0);
  const pageCount = m.FPDF_GetPageCount(doc);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = m.FPDF_LoadPage(doc, pageIndex);
    if (!page) continue;
    const textPage = m.FPDFText_LoadPage(page);
    try {
      if (!textPage) continue;
      withWString(m, query, (queryPtr) => {
        const search = m.FPDFText_FindStart(textPage, queryPtr, flags, 0);
        if (!search) return;
        try {
          while (m.FPDFText_FindNext(search)) {
            const start = m.FPDFText_GetSchResultIndex(search);
            const count = m.FPDFText_GetSchCount(search);
            const quads = matchRects(m, textPage, start, count);
            if (quads.length > 0) matches.push({ pageIndex, quads });
            if (matches.length >= MAX_TEXT_MATCHES) return;
          }
        } finally {
          m.FPDFText_FindClose(search);
        }
      });
    } finally {
      if (textPage) m.FPDFText_ClosePage(textPage);
      m.FPDF_ClosePage(page);
    }
    if (matches.length >= MAX_TEXT_MATCHES) return { matches, truncated: true };
  }
  return { matches, truncated: false };
}
