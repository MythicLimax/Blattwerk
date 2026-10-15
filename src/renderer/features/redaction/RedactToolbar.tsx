import { Check, MousePointer2, Redo2, ScanSearch, SquareDashed, TextCursor, Trash, Undo2, X, type LucideIcon, EyeOff as EyeOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { ModeBadge } from '../../components/ModeBadge';
import { executeCommand } from '../../engine/session';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { useAnnotations, useTabAnnotations, type Tool } from '../../state/annotations-store';
import { canRedoState, canUndoState, useTabHistory } from '../../state/dirty';
import type { TabState } from '../../state/documents-store';
import { cachedGeometry, markupSelection } from '../annotations/AnnotationLayer';
import styles from '../annotations/CommentToolbar.module.css';
import { isRedaction } from './plan';
import toolbarStyles from './RedactToolbar.module.css';

const TOOLS: Array<{ tool: Tool; icon: LucideIcon }> = [
  { tool: 'select', icon: MousePointer2 },
  { tool: 'redact', icon: SquareDashed },
  { tool: 'redactText', icon: TextCursor },
];

// Werkzeugleiste „Schwärzen“: Bereiche und Text markieren, suchen, anwenden
export function RedactToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const annotations = useTabAnnotations(tab.id);
  const history = useTabHistory(tab.id);
  const tool = useAnnotations((s) => s.tool);
  const marks = annotations?.items.filter(isRedaction).length ?? 0;
  const selected = annotations?.items.find((a) => a.id === annotations.selectedId);
  const readOnly = !tab.canAnnotate;

  const chooseTool = (next: Tool) => {
    const store = useAnnotations.getState();
    // Schon markierter Text wird sofort zur Schwärzung (wie beim Hervorheben).
    if (next === 'redactText' && markupSelection(tab.id, next, (page) => cachedGeometry(tab.id, page))) return;
    store.setTool(next);
    store.select(tab.id, null);
    focusViewer(getRuntime(tab.id));
  };

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={t('redaction.toolbar')}
      data-testid="redact-toolbar"
      data-tone="redact"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <ModeBadge tone="redact" icon={EyeOffIcon} label={t('toolbar.redact')} />
      <div className={styles.group}>
        {TOOLS.map(({ tool: id, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(`redaction.tools.${id}`)}
            pressed={tool === id}
            disabled={readOnly && id !== 'select'}
            onClick={() => chooseTool(id)}
            data-testid={`redact-tool-${id}`}
          />
        ))}
        <IconButton
          icon={ScanSearch}
          label={t('redaction.find')}
          disabled={readOnly}
          onClick={() => executeCommand('redact.find')}
          data-testid="redact-find"
        />
      </div>
      <span className={styles.separator} />
      <div className={styles.group}>
        <IconButton
          icon={Trash}
          label={t('redaction.delete')}
          disabled={!selected || !isRedaction(selected) || readOnly}
          onClick={() => executeCommand('edit.delete')}
          data-testid="redact-delete"
        />
        <IconButton
          icon={Undo2}
          label={t('comments.undo')}
          disabled={!canUndoState(annotations, history)}
          onClick={() => executeCommand('edit.undo')}
        />
        <IconButton
          icon={Redo2}
          label={t('comments.redo')}
          disabled={!canRedoState(annotations, history)}
          onClick={() => executeCommand('edit.redo')}
        />
      </div>
      <span className={styles.notice} data-testid="redact-hint">
        {readOnly ? t('redaction.notAllowed') : tab.encrypted ? t('redaction.encrypted') : t('redaction.hint')}
      </span>
      <span className={styles.spacer} />
      <button
        type="button"
        className={toolbarStyles.apply}
        disabled={marks === 0 || tab.encrypted || tab.working}
        onClick={() => executeCommand('redact.apply')}
        data-testid="redact-apply"
      >
        <Check size={14} aria-hidden="true" />
        {marks === 0 ? t('redaction.apply') : t('redaction.applyCount', { count: marks })}
      </button>
      <IconButton icon={X} label={t('redaction.close')} onClick={() => executeCommand('redact.tools')} data-testid="redact-close" />
    </div>
  );
}
