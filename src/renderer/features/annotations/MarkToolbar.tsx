import { Check, Highlighter, Redo2, Strikethrough, Trash, Underline, Undo2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../../shared/annotations';
import { ColorPicker } from '../../components/ColorPicker';
import { IconButton } from '../../components/IconButton';
import { ModeBadge } from '../../components/ModeBadge';
import { GLASS, useLiquidGlass } from '../../components/glass/liquid-glass';
import { executeCommand } from '../../engine/session';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { useAnnotations, useTabAnnotations } from '../../state/annotations-store';
import { canRedoState, canUndoState, useTabHistory } from '../../state/dirty';
import type { TabState } from '../../state/documents-store';
import { updateAnnotation } from './controller';
import { toggleMarkTools } from './mark-actions';
import styles from './CommentToolbar.module.css';

type MarkKind = 'highlight' | 'underline' | 'strikeout';

const KINDS: Array<{ kind: MarkKind; icon: LucideIcon }> = [
  { kind: 'highlight', icon: Highlighter },
  { kind: 'underline', icon: Underline },
  { kind: 'strikeout', icon: Strikethrough },
];

const isMarkKind = (kind: string): kind is MarkKind => kind === 'highlight' || kind === 'underline' || kind === 'strikeout';

// Leiste „Markieren“: Art und Farbe wählen, dann Text auswählen. Ein Klick auf eine Markierung wählt sie aus; dann
// gelten Art und Farbe für sie, und die Anfasser an ihren Enden kürzen oder verlängern sie.
export function MarkToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const annotations = useTabAnnotations(tab.id);
  const history = useTabHistory(tab.id);
  const tool = useAnnotations((s) => s.tool);
  const colors = useAnnotations((s) => s.colors);
  const glassRef = useLiquidGlass<HTMLDivElement>(GLASS.control);
  const found = annotations?.items.find((a) => a.id === annotations.selectedId);
  const selected = found && (found.kind === 'highlight' || found.kind === 'underline' || found.kind === 'strikeout' || found.kind === 'squiggly') ? found : undefined;
  const current: MarkKind = selected && isMarkKind(selected.kind) ? selected.kind : isMarkKind(tool) ? tool : 'highlight';
  const color = selected ? selected.color : colors[current];

  const chooseKind = (kind: MarkKind) => {
    const store = useAnnotations.getState();
    store.setTool(kind);
    if (selected && selected.kind !== kind) updateAnnotation(tab.id, selected, { ...selected, kind, color: colors[kind] });
    focusViewer(getRuntime(tab.id));
  };

  const chooseColor = (next: Rgb) => {
    useAnnotations.getState().setColor(current, next);
    if (selected) updateAnnotation(tab.id, selected, { ...selected, color: next });
  };

  return (
    <div
      ref={glassRef}
      className={styles.bar}
      role="toolbar"
      aria-label={t('mark.toolbar')}
      data-testid="mark-toolbar"
      data-tone="mark"
      onMouseDown={(event) => {
        // Die Textauswahl im Dokument bleibt erhalten
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <ModeBadge tone="mark" icon={Highlighter} label={t('mark.title')} />
      <div className={styles.group}>
        {KINDS.map(({ kind, icon }) => (
          <IconButton key={kind} icon={icon} label={t(`tools.${kind}`)} pressed={current === kind && (selected !== undefined || tool === kind)} onClick={() => chooseKind(kind)} data-testid={`mark-${kind}`} />
        ))}
      </div>
      <span className={styles.separator} />
      <ColorPicker value={color} onChange={chooseColor} nameOf={(id) => t(`colors.${id}`)} label={t('mark.color')} testId="mark-color" favoriteSet="comment" />
      <span className={styles.separator} />
      <IconButton icon={Trash} label={t('mark.delete')} disabled={!selected} onClick={() => executeCommand('edit.delete')} data-testid="mark-delete" />
      <span className={styles.notice}>{selected ? t('mark.selectedHint') : t('mark.hint')}</span>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <IconButton icon={Undo2} label={t('comments.undo')} disabled={!canUndoState(annotations, history)} onClick={() => executeCommand('edit.undo')} />
        <IconButton icon={Redo2} label={t('comments.redo')} disabled={!canRedoState(annotations, history)} onClick={() => executeCommand('edit.redo')} />
        <IconButton icon={Check} label={t('mark.done')} onClick={() => toggleMarkTools(tab)} data-testid="mark-done" />
      </div>
    </div>
  );
}
