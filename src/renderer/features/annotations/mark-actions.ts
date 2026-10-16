// Modus „Markieren“: eigene Leiste zum Hervorheben, Unterstreichen und Durchstreichen von Text. Erst mit diesem Modus
// wird ausgewählter Text markiert; außerhalb bleibt Auswählen ein normales Auswählen (z. B. zum Kopieren).
import { focusViewer, getRuntime } from '../../engine/runtime';
import { commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import { useAnnotations } from '../../state/annotations-store';
import { useDocuments, type TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { toggleFormEditing } from '../form-edit/actions';
import { cachedGeometry, markupSelection } from './AnnotationLayer';

export const MARK_TOOLS = ['highlight', 'underline', 'strikeout'] as const;

export function toggleMarkTools(tab: TabState): void {
  if (tab.status !== 'ready' || tab.mode !== 'view') return;
  const ui = useUi.getState();
  const store = useAnnotations.getState();
  if (ui.markToolsVisible) {
    ui.setMarkToolsVisible(false);
    store.setTool('select');
    store.select(tab.id, null);
    return;
  }
  if (!tab.canAnnotate) {
    ui.notify(t('mark.notAllowed'));
    return;
  }
  commitPendingEdits();
  if (tab.formEditing) toggleFormEditing(tab);
  if (tab.contentEditing) useDocuments.getState().updateTab(tab.id, { contentEditing: false });
  ui.setMarkToolsVisible(true);
  store.select(tab.id, null);
  store.setTool('highlight');
  // Schon ausgewählter Text wird gleich hervorgehoben
  markupSelection(tab.id, 'highlight', (page) => cachedGeometry(tab.id, page));
  requestAnimationFrame(() => focusViewer(getRuntime(tab.id)));
}
