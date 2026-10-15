// Modus „Inhalt bearbeiten“ (Phase 5): ein- und ausschalten, Text und Bilder einfügen, Objekte ändern.
// Jede Änderung ist eine Inhaltsoperation und damit ein neuer Dokumentstand (Rückgängig wie bei Seiten).
import type { Point, Rect } from '../../../shared/annotations';
import { LINE_HEIGHT, type ContentOperation, type EditUnit, type Matrix, type ParagraphStyle } from '../../../shared/content';
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

function run(tabId: string, operation: ContentOperation | ContentOperation[]): Promise<boolean> {
  return applyContentOperations(tabId, Array.isArray(operation) ? operation : [operation], { keepScroll: true });
}

// Neuer Text: at ist die linke obere Ecke der ersten Zeile in PDF-Punkten; baseline die erste Grundlinie
// width: Breite (Punkt), in der der Text umbricht; ohne Angabe nur an Zeilenumbrüchen
export async function addText(tabId: string, pageIndex: number, baseline: Point, value: string, width?: number): Promise<boolean> {
  const lines = value.replace(/\s+$/, '').split('\n');
  if (lines.every((line) => line.trim() === '')) return false;
  const { style } = useContentEdit.getState();
  return run(tabId, { type: 'addText', pageIndex, origin: baseline, lines, font: style.font, size: style.size, color: style.color, ...(width ? { width } : {}) });
}

// merge: weitere Stücke derselben Zeile (siehe lineOf), die im ersten aufgehen
export async function editText(tabId: string, pageIndex: number, index: number, merge: number[], value: string, before: string): Promise<boolean> {
  const text = value.replace(/\n/g, ' ');
  if (text === before) return false;
  // Leere Zeile: wie Löschen
  if (text.trim() === '') return run(tabId, { type: 'delete', pageIndex, indices: [index, ...merge] });
  return run(tabId, { type: 'editText', pageIndex, index, text, ...(merge.length > 0 ? { merge } : {}) });
}

// members: alle Objekte der Einheit (index ist ihr Anker)
// Absatz: Text mit harten Umbrüchen, der Worker bricht in der Breite des Absatzes um
export async function editParagraph(tabId: string, pageIndex: number, lines: number[][], value: string, before: string): Promise<boolean> {
  const text = value.replace(/\r/g, '').replace(/[ \t]+$/gm, '');
  if (text === before) return false;
  if (text.trim() === '') return run(tabId, { type: 'delete', pageIndex, indices: lines.flat() });
  return run(tabId, { type: 'editParagraph', pageIndex, lines, text });
}

// Zeile oder Absatz neu setzen: andere Breite (box, Seitenkoordinaten der sichtbaren Ränder), Größe, Schrift oder
// Farbe. Der Text bricht dabei in der Breite neu um.
export async function reflowText(
  tabId: string,
  pageIndex: number,
  unit: Pick<EditUnit, 'index' | 'members' | 'lines' | 'bounds'>,
  text: string,
  change: { box?: { left: number; right: number }; style?: ParagraphStyle; bounds?: Rect },
): Promise<boolean> {
  const value = text.replace(/\r/g, '').replace(/[ \t]+$/gm, '');
  if (value.trim() === '') return run(tabId, { type: 'delete', pageIndex, indices: unit.members });
  const store = useContentEdit.getState();
  if (change.bounds) store.setPending(tabId, { pageIndex, index: unit.index, bounds: change.bounds });
  // Die bisherige Auswahl gilt nicht mehr (Objekte und Text ändern sich). Nach dem Neuladen wird der Text an seiner
  // linken oberen Ecke wieder ausgewählt.
  store.select(tabId, null);
  const [left, , , top] = change.bounds ?? unit.bounds;
  try {
    const done = await run(tabId, {
      type: 'editParagraph',
      pageIndex,
      lines: unit.lines ?? [unit.members],
      text: value,
      ...(change.box ? { box: change.box } : {}),
      ...(change.style ? { style: change.style } : {}),
    });
    if (done) store.setReselect({ tabId, pageIndex, at: { x: left + 1, y: top - 1 } });
    return done;
  } finally {
    if (change.bounds) store.setPending(tabId, null);
  }
}

// members: alle Objekte der Einheit (index ist ihr Anker)
export async function transformObject(tabId: string, pageIndex: number, index: number, members: number[], matrix: Matrix, bounds: Rect): Promise<void> {
  const store = useContentEdit.getState();
  store.setPending(tabId, { pageIndex, index, bounds });
  try {
    await run(tabId, members.map((member) => ({ type: 'transform' as const, pageIndex, index: member, matrix })));
  } finally {
    store.setPending(tabId, null);
  }
}

export function deleteSelectedObject(tab: TabState): boolean {
  const store = useContentEdit.getState();
  const selected = store.selected[tab.id];
  if (!tab.contentEditing || !selected) return false;
  store.select(tab.id, null);
  void run(tab.id, { type: 'delete', pageIndex: selected.pageIndex, indices: selected.members });
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

// Abstand der ersten Grundlinie von der Oberkante einer Zeile (Zeilenhöhe 1,2): halber Durchschuss 0,1 plus
// Oberlänge der Standardschriften (etwa 0,76). So steht der Text nach dem Übernehmen dort, wo er in der Eingabe stand.
export const baselineOffset = (size: number) => size * 0.86;
export const lineHeight = (size: number) => size * LINE_HEIGHT;
// Neuer Text: Die Klickstelle ist die Mitte der ersten Zeile (wie der Strich des Textzeigers). Abstand der Grundlinie
// von dort nach unten.
export const baselineBelowClick = (size: number) => baselineOffset(size) - lineHeight(size) / 2;
