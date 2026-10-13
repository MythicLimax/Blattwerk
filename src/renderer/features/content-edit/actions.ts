// Modus „Inhalt bearbeiten“ (Phase 5): ein- und ausschalten, Text und Bilder einfügen, Objekte ändern.
// Jede Änderung ist eine Inhaltsoperation und damit ein neuer Dokumentstand (Rückgängig wie bei Seiten).
import type { Point, Rect } from '../../../shared/annotations';
import { LINE_HEIGHT, type ContentOperation, type Matrix } from '../../../shared/content';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { applyContentOperations, commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import { useAnnotations } from '../../state/annotations-store';
import { useContentEdit } from '../../state/content-edit-store';
import { useDocuments, type TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { toggleFormEditing } from '../form-edit/actions';
import { imageSource, pickSources } from '../pages/actions';

export function toggleContentEditing(tab: TabState): void {
  if (tab.status !== 'ready' || tab.mode !== 'view') return;
  const store = useContentEdit.getState();
  if (tab.contentEditing) {
    useDocuments.getState().updateTab(tab.id, { contentEditing: false });
    store.select(tab.id, null);
    store.setEditing(null);
    store.setTool('select');
    requestAnimationFrame(() => focusViewer(getRuntime(tab.id)));
    return;
  }
  if (!tab.canModify) {
    useUi.getState().notify(t('contentEdit.notAllowed'));
    return;
  }
  commitPendingEdits();
  if (tab.formEditing) toggleFormEditing(tab);
  const ui = useUi.getState();
  if (ui.commentToolsVisible) ui.setCommentToolsVisible(false);
  if (ui.redactToolsVisible) ui.setRedactToolsVisible(false);
  useAnnotations.getState().setTool('select');
  useAnnotations.getState().select(tab.id, null);
  store.setTool('select');
  useDocuments.getState().updateTab(tab.id, { contentEditing: true });
}

function run(tabId: string, operation: ContentOperation): Promise<boolean> {
  return applyContentOperations(tabId, [operation], { keepScroll: true });
}

// Neuer Text: at ist die linke obere Ecke der ersten Zeile in PDF-Punkten; baseline die erste Grundlinie
export async function addText(tabId: string, pageIndex: number, baseline: Point, value: string): Promise<boolean> {
  const lines = value.replace(/\s+$/, '').split('\n');
  if (lines.every((line) => line.trim() === '')) return false;
  const { style } = useContentEdit.getState();
  return run(tabId, { type: 'addText', pageIndex, origin: baseline, lines, font: style.font, size: style.size, color: style.color });
}

export async function editText(tabId: string, pageIndex: number, index: number, value: string, before: string): Promise<boolean> {
  const text = value.replace(/\n/g, ' ');
  if (text === before) return false;
  // Leere Zeile: wie Löschen
  if (text.trim() === '') return run(tabId, { type: 'delete', pageIndex, indices: [index] });
  return run(tabId, { type: 'editText', pageIndex, index, text });
}

export async function transformObject(tabId: string, pageIndex: number, index: number, matrix: Matrix, bounds: Rect): Promise<void> {
  const store = useContentEdit.getState();
  store.setPending(tabId, { pageIndex, index, bounds });
  try {
    await run(tabId, { type: 'transform', pageIndex, index, matrix });
  } finally {
    store.setPending(tabId, null);
  }
}

export function deleteSelectedObject(tab: TabState): boolean {
  const store = useContentEdit.getState();
  const selected = store.selected[tab.id];
  if (!tab.contentEditing || !selected) return false;
  store.select(tab.id, null);
  void run(tab.id, { type: 'delete', pageIndex: selected.pageIndex, indices: [selected.index] });
  return true;
}

// Bild wählen und mittig auf die aktuelle Seite legen (höchstens halbe Seitenbreite, Seitenverhältnis bleibt)
export async function addImage(tab: TabState): Promise<void> {
  const runtime = getRuntime(tab.id);
  const pdf = runtime?.pdf;
  if (!pdf) return;
  const picked = await pickSources('images');
  const first = picked?.[0];
  if (!first?.image) return;
  const source = imageSource(first);
  const pageIndex = Math.max(0, tab.currentPage - 1);
  const page = await pdf.getPage(pageIndex + 1);
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.view;
  // Auf gedrehten Seiten aufrecht zur Anzeige: Maße in der Ansicht berechnen, Bild gegenläufig drehen
  const turned = page.rotate % 180 !== 0;
  const viewWidth = turned ? y1 - y0 : x1 - x0;
  const viewHeight = turned ? x1 - x0 : y1 - y0;
  const swapped = source.rotation === 90 || source.rotation === 270;
  const aspect = swapped ? source.width / source.height : source.height / source.width;
  // 1 Pixel = 1 Punkt, aber höchstens halbe Seitenbreite bzw. -höhe
  let width = Math.min(swapped ? source.height : source.width, viewWidth / 2);
  let height = width * aspect;
  if (height > viewHeight / 2) {
    height = viewHeight / 2;
    width = height / aspect;
  }
  const [userWidth, userHeight] = turned ? [height, width] : [width, height];
  const left = (x0 + x1 - userWidth) / 2;
  const bottom = (y0 + y1 - userHeight) / 2;
  const rotation = (((source.rotation - page.rotate) % 360) + 360) % 360;
  await run(tab.id, {
    type: 'addImage',
    pageIndex,
    rect: [left, bottom, left + userWidth, bottom + userHeight],
    image: { ...source, rotation: rotation as typeof source.rotation },
  });
}

// Abstand der ersten Grundlinie von der Oberkante der Eingabe
export const baselineOffset = (size: number) => size * 0.8;
export const lineHeight = (size: number) => size * LINE_HEIGHT;
