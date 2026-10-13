// Schwärzen (Phase 5): Leiste ein- und ausschalten, Text suchen und markieren, Anwenden vorbereiten.
import type { TextMatch, TextSearchOptions } from '../../../shared/redaction';
import { findTextMatches } from '../../engine/pdfium-client';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import { tabAnnotations, useAnnotations } from '../../state/annotations-store';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { addAnnotations, baseFields } from '../annotations/controller';
import { createRedaction } from '../annotations/create';
import { toggleFormEditing } from '../form-edit/actions';
import { isRedaction } from './plan';

export function toggleRedactTools(tab: TabState): void {
  if (tab.status !== 'ready' || tab.mode !== 'view') return;
  const ui = useUi.getState();
  const store = useAnnotations.getState();
  if (ui.redactToolsVisible) {
    ui.setRedactToolsVisible(false);
    store.setTool('select');
    return;
  }
  if (!tab.canAnnotate) {
    useUi.getState().notify(t('redaction.notAllowed'));
    return;
  }
  commitPendingEdits();
  if (tab.formEditing) toggleFormEditing(tab);
  ui.setRedactToolsVisible(true);
  store.select(tab.id, null);
  // Wie in Acrobat: Markieren ist sofort aktiv
  store.setTool('redact');
  requestAnimationFrame(() => focusViewer(getRuntime(tab.id)));
}

export function redactionMarkCount(tabId: string): number {
  return tabAnnotations(tabId)?.items.filter(isRedaction).length ?? 0;
}

export function openRedactApply(tab: TabState): void {
  if (tab.status !== 'ready') return;
  commitPendingEdits();
  if (redactionMarkCount(tab.id) === 0) {
    useUi.getState().notify(t('redaction.noMarks'));
    return;
  }
  useUi.getState().setRedactDialog('apply');
}

export function openRedactFind(tab: TabState): void {
  if (tab.status !== 'ready' || tab.mode !== 'view') return;
  if (!tab.canAnnotate) {
    useUi.getState().notify(t('redaction.notAllowed'));
    return;
  }
  if (!useUi.getState().redactToolsVisible) toggleRedactTools(tab);
  useUi.getState().setRedactDialog('find');
}

export async function findForRedaction(tabId: string, options: TextSearchOptions): Promise<{ matches: TextMatch[]; truncated: boolean }> {
  const runtime = getRuntime(tabId);
  if (!runtime?.pdf) return { matches: [], truncated: false };
  return findTextMatches(await runtime.pdf.getData(), runtime.password, options);
}

// Alle Treffer als Schwärzungsmarkierungen (ein Schritt für Rückgängig)
export function markMatches(tabId: string, matches: TextMatch[]): void {
  const color = useAnnotations.getState().colors.redactText;
  addAnnotations(
    tabId,
    matches.map((match) => createRedaction(baseFields(match.pageIndex), [0, 0, 0, 0], match.quads, color)),
  );
}

// Enthält das Dokument digitale Signaturen? Sie werden durch das Schwärzen ungültig.
export async function hasSignatures(tabId: string): Promise<boolean> {
  const pdf = getRuntime(tabId)?.pdf;
  if (!pdf) return false;
  try {
    const fields = (await pdf.getFieldObjects()) as unknown as Map<string, Array<{ type?: string }>> | null;
    return [...(fields?.values() ?? [])].some((list) => list.some((field) => field.type === 'signature'));
  } catch {
    return false;
  }
}
