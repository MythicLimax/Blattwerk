// Liest die aktuelle Textauswahl aus der pdf.js-Textebene und rechnet sie je Seite in PDF-Rechtecke um.
import type { Rect } from '../../../shared/annotations';
import type { PageGeometry } from '../../engine/coords';

export interface SelectedRects {
  pageIndex: number;
  rects: Rect[];
}

function pageIndexOf(node: Node): { pageIndex: number; pageDiv: HTMLElement } | null {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element?.closest('.textLayer')) return null;
  const pageDiv = element.closest<HTMLElement>('.page[data-page-number]');
  const number = Number(pageDiv?.dataset.pageNumber);
  return pageDiv && Number.isInteger(number) ? { pageIndex: number - 1, pageDiv } : null;
}

// Rechtecke der ausgewählten Textstücke. Je Textknoten ein eigener Teilbereich, damit keine
// großen Rechtecke von Blockelementen (Zeilenumbrüche, Ende der Textebene) mitkommen.
export function selectedTextRects(
  selection: Selection | null,
  root: HTMLElement,
  geometryOf: (pageIndex: number) => PageGeometry | undefined,
): SelectedRects[] {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];
  const ranges: Range[] = [];
  for (let r = 0; r < selection.rangeCount; r++) ranges.push(selection.getRangeAt(r));
  return rangeTextRects(ranges, root, geometryOf);
}

// Wie oben, für beliebige Textbereiche (z. B. beim Ziehen am Ende einer Markierung)
export function rangeTextRects(
  ranges: Range[],
  root: HTMLElement,
  geometryOf: (pageIndex: number) => PageGeometry | undefined,
): SelectedRects[] {
  const byPage = new Map<number, Rect[]>();
  for (const range of ranges) {
    if (range.collapsed || !root.contains(range.commonAncestorContainer)) continue;
    const ancestor = range.commonAncestorContainer;
    const textNodes: Text[] = [];
    if (ancestor instanceof Text) {
      textNodes.push(ancestor);
    } else {
      const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (range.intersectsNode(node)) textNodes.push(node as Text);
      }
    }
    for (const node of textNodes) {
      const page = pageIndexOf(node);
      const geometry = page ? geometryOf(page.pageIndex) : undefined;
      if (!page || !geometry) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      if (end <= start || node.data.slice(start, end).trim() === '') continue;
      const sub = document.createRange();
      sub.setStart(node, start);
      sub.setEnd(node, end);
      const pageBox = page.pageDiv.getBoundingClientRect();
      const sx = geometry.width / pageBox.width;
      const sy = geometry.height / pageBox.height;
      for (const box of Array.from(sub.getClientRects())) {
        if (box.width < 0.5 || box.height < 0.5) continue;
        const a = geometry.toPdf((box.left - pageBox.left) * sx, (box.top - pageBox.top) * sy);
        const b = geometry.toPdf((box.right - pageBox.left) * sx, (box.bottom - pageBox.top) * sy);
        const list = byPage.get(page.pageIndex) ?? [];
        list.push([Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)]);
        byPage.set(page.pageIndex, list);
      }
    }
  }
  return [...byPage].map(([pageIndex, rects]) => ({ pageIndex, rects }));
}
