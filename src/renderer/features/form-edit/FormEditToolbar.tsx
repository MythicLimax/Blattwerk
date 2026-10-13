import {
  Check,
  CircleDot,
  List,
  MousePointer2,
  Redo2,
  Settings2,
  SquareCheck,
  SquareChevronDown,
  TextCursorInput,
  Trash,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../components/IconButton';
import { executeCommand } from '../../engine/session';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { useTabAnnotations } from '../../state/annotations-store';
import { canRedoState, canUndoState, useTabHistory } from '../../state/dirty';
import type { TabState } from '../../state/documents-store';
import { useFormEdit, type FieldTool } from '../../state/form-edit-store';
import styles from '../annotations/CommentToolbar.module.css';
import { openFieldProperties, toggleFormEditing } from './actions';

const TOOLS: Array<{ tool: FieldTool; icon: LucideIcon }> = [
  { tool: 'select', icon: MousePointer2 },
  { tool: 'text', icon: TextCursorInput },
  { tool: 'checkbox', icon: SquareCheck },
  { tool: 'radio', icon: CircleDot },
  { tool: 'dropdown', icon: SquareChevronDown },
  { tool: 'list', icon: List },
];

// Werkzeugleiste im Modus „Formular bearbeiten“
export function FormEditToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const tool = useFormEdit((s) => s.tool);
  const selected = useFormEdit((s) => s.selected[tab.id] ?? null);
  const annotations = useTabAnnotations(tab.id);
  const history = useTabHistory(tab.id);

  const chooseTool = (next: FieldTool) => {
    const store = useFormEdit.getState();
    store.setTool(next === tool && next !== 'select' ? 'select' : next);
    store.select(tab.id, null);
    focusViewer(getRuntime(tab.id));
  };

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={t('formEdit.toolbar')}
      data-testid="form-edit-toolbar"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <div className={styles.group}>
        {TOOLS.map(({ tool: id, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(`formEdit.tools.${id}`)}
            pressed={tool === id}
            disabled={tab.working}
            onClick={() => chooseTool(id)}
            data-testid={`field-tool-${id}`}
          />
        ))}
      </div>
      <span className={styles.separator} />
      <div className={styles.group}>
        <IconButton
          icon={Settings2}
          label={t('formEdit.properties')}
          disabled={!selected || !selected.kind || tab.working}
          onClick={() => selected && openFieldProperties(tab.id, selected)}
          data-testid="field-properties"
        />
        <IconButton
          icon={Trash}
          label={t('formEdit.delete')}
          disabled={!selected || tab.working}
          onClick={() => executeCommand('edit.delete')}
          data-testid="field-delete"
        />
      </div>
      <span className={styles.notice}>{tool === 'select' ? t('formEdit.selectHint') : t('formEdit.hint')}</span>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <IconButton
          icon={Undo2}
          label={t('comments.undo')}
          disabled={!canUndoState(annotations, history)}
          onClick={() => executeCommand('edit.undo')}
          data-testid="field-undo"
        />
        <IconButton
          icon={Redo2}
          label={t('comments.redo')}
          disabled={!canRedoState(annotations, history)}
          onClick={() => executeCommand('edit.redo')}
          data-testid="field-redo"
        />
        <IconButton icon={Check} label={t('formEdit.done')} onClick={() => toggleFormEditing(tab)} data-testid="form-edit-done" />
      </div>
    </div>
  );
}
