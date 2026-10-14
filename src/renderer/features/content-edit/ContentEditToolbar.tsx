import { Check, ImagePlus, MousePointer2, Redo2, Trash, Type, Undo2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../../shared/annotations';
import { STAMP_FONTS, type StampFont } from '../../../shared/stamping';
import { IconButton } from '../../components/IconButton';
import { executeCommand } from '../../engine/session';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { useTabAnnotations } from '../../state/annotations-store';
import { useContentEdit, type ContentTool } from '../../state/content-edit-store';
import { canRedoState, canUndoState, useTabHistory } from '../../state/dirty';
import type { TabState } from '../../state/documents-store';
import styles from '../annotations/CommentToolbar.module.css';
import { addImage, toggleContentEditing } from './actions';

const TOOLS: Array<{ tool: ContentTool; icon: LucideIcon }> = [
  { tool: 'select', icon: MousePointer2 },
  { tool: 'text', icon: Type },
];

const COLORS: Array<{ id: string; color: Rgb }> = [
  { id: 'black', color: { r: 0, g: 0, b: 0 } },
  { id: 'blue', color: { r: 0.15, g: 0.3, b: 0.75 } },
  { id: 'red', color: { r: 0.8, g: 0.1, b: 0.1 } },
  { id: 'gray', color: { r: 0.5, g: 0.5, b: 0.5 } },
];

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 32, 48];
const toCss = ({ r, g, b }: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

// Werkzeugleiste im Modus „Inhalt bearbeiten“
export function ContentEditToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const tool = useContentEdit((s) => s.tool);
  const style = useContentEdit((s) => s.style);
  const selected = useContentEdit((s) => s.selected[tab.id] ?? null);
  const annotations = useTabAnnotations(tab.id);
  const history = useTabHistory(tab.id);

  const chooseTool = (next: ContentTool) => {
    const store = useContentEdit.getState();
    store.setTool(next === tool && next !== 'select' ? 'select' : next);
    store.select(tab.id, null);
    focusViewer(getRuntime(tab.id));
  };

  return (
    <div
      className={styles.bar}
      role="toolbar"
      aria-label={t('contentEdit.toolbar')}
      data-testid="content-edit-toolbar"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <div className={styles.group}>
        {TOOLS.map(({ tool: id, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(`contentEdit.tools.${id}`)}
            pressed={tool === id}
            disabled={tab.working}
            onClick={() => chooseTool(id)}
            data-testid={`content-tool-${id}`}
          />
        ))}
        <IconButton
          icon={ImagePlus}
          label={t('contentEdit.tools.image')}
          disabled={tab.working}
          onClick={() => void addImage(tab)}
          data-testid="content-add-image"
        />
      </div>
      <span className={styles.separator} />
      <select
        className={styles.select}
        value={style.font}
        aria-label={t('contentEdit.font')}
        data-tooltip={t('contentEdit.font')}
        onChange={(event) => useContentEdit.getState().setStyle({ font: event.target.value as StampFont })}
        data-testid="content-font"
      >
        {STAMP_FONTS.map((font) => (
          <option key={font} value={font}>
            {t(`stamp.fonts.${font}`)}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={style.size}
        aria-label={t('contentEdit.size')}
        data-tooltip={t('contentEdit.size')}
        onChange={(event) => useContentEdit.getState().setStyle({ size: Number(event.target.value) })}
        data-testid="content-size"
      >
        {SIZES.map((size) => (
          <option key={size} value={size}>
            {t('stamp.points', { value: size })}
          </option>
        ))}
      </select>
      <div className={styles.group} role="radiogroup" aria-label={t('contentEdit.color')}>
        {COLORS.map(({ id, color }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={style.color === color}
            className={styles.swatch}
            style={{ background: toCss(color) }}
            data-tooltip={t(`stamp.colors.${id}`)}
            aria-label={t(`stamp.colors.${id}`)}
            onClick={() => useContentEdit.getState().setStyle({ color })}
          />
        ))}
      </div>
      <span className={styles.separator} />
      <IconButton
        icon={Trash}
        label={t('contentEdit.delete')}
        disabled={!selected || tab.working}
        onClick={() => executeCommand('edit.delete')}
        data-testid="content-delete"
      />
      <span className={styles.notice}>{tool === 'text' ? t('contentEdit.textHint') : t('contentEdit.selectHint')}</span>
      <span className={styles.spacer} />
      <div className={styles.group}>
        <IconButton icon={Undo2} label={t('comments.undo')} disabled={!canUndoState(annotations, history)} onClick={() => executeCommand('edit.undo')} />
        <IconButton icon={Redo2} label={t('comments.redo')} disabled={!canRedoState(annotations, history)} onClick={() => executeCommand('edit.redo')} />
        <IconButton icon={Check} label={t('contentEdit.done')} onClick={() => toggleContentEditing(tab)} data-testid="content-edit-done" />
      </div>
    </div>
  );
}
