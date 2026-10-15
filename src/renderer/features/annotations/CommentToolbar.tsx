import {
  Circle,
  Highlighter,
  Minus,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Redo2,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  Trash,
  Type,
  Underline,
  Undo2,
  type LucideIcon,
  MessageSquare as MessageSquareIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Annotation, Rgb, StampId } from '../../../shared/annotations';
import { rgbEquals, STAMP_IDS } from '../../../shared/annotations';
import { IconButton } from '../../components/IconButton';
import { ModeBadge } from '../../components/ModeBadge';
import { GLASS, useLiquidGlass } from '../../components/glass/liquid-glass';
import { executeCommand } from '../../engine/session';
import { focusViewer, getRuntime } from '../../engine/runtime';
import { MARKUP_TOOLS, useAnnotations, useTabAnnotations, type Tool } from '../../state/annotations-store';
import { canRedoState, canUndoState, useTabHistory } from '../../state/dirty';
import type { TabState } from '../../state/documents-store';
import { cachedGeometry, markupSelection } from './AnnotationLayer';
import { updateAnnotation } from './controller';
import styles from './CommentToolbar.module.css';

const TOOLS: Array<{ tool: Tool; icon: LucideIcon }> = [
  { tool: 'select', icon: MousePointer2 },
  { tool: 'highlight', icon: Highlighter },
  { tool: 'underline', icon: Underline },
  { tool: 'strikeout', icon: Strikethrough },
  { tool: 'note', icon: StickyNote },
  { tool: 'freetext', icon: Type },
  { tool: 'ink', icon: PenLine },
  { tool: 'square', icon: Square },
  { tool: 'circle', icon: Circle },
  { tool: 'line', icon: Minus },
  { tool: 'arrow', icon: MoveUpRight },
  { tool: 'stamp', icon: Stamp },
];

export const PALETTE: Array<{ id: string; color: Rgb }> = [
  { id: 'yellow', color: { r: 1, g: 0.86, b: 0.2 } },
  { id: 'green', color: { r: 0.3, g: 0.75, b: 0.3 } },
  { id: 'blue', color: { r: 0.18, g: 0.44, b: 0.87 } },
  { id: 'red', color: { r: 0.85, g: 0.11, b: 0.11 } },
  { id: 'purple', color: { r: 0.56, g: 0.27, b: 0.68 } },
  { id: 'orange', color: { r: 1, g: 0.55, b: 0.1 } },
  { id: 'black', color: { r: 0, g: 0, b: 0 } },
];

const WIDTHS = [1, 2, 3, 4, 6, 8];
const FONT_SIZES = [8, 9, 10, 12, 14, 18, 24, 36];
const WIDTH_KINDS = new Set<Tool>(['ink', 'square', 'circle', 'line', 'arrow']);

const toCss = ({ r, g, b }: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

export function CommentToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const annotations = useTabAnnotations(tab.id);
  const history = useTabHistory(tab.id);
  const tool = useAnnotations((s) => s.tool);
  const colors = useAnnotations((s) => s.colors);
  const width = useAnnotations((s) => s.width);
  const fontSize = useAnnotations((s) => s.fontSize);
  const stamp = useAnnotations((s) => s.stamp);
  const selected: Annotation | undefined = annotations?.items.find((a) => a.id === annotations.selectedId);
  const readOnly = !tab.canAnnotate;

  // Farbe und Stärke gelten für den ausgewählten Kommentar, sonst für das aktive Werkzeug.
  const target: Tool | null = selected ? selected.kind : tool === 'select' ? null : tool;
  const currentColor = selected ? selected.color : target ? colors[target] : null;
  const currentWidth = selected && 'width' in selected ? selected.width : width;
  const currentFontSize = selected?.kind === 'freetext' ? selected.fontSize : fontSize;
  const showColor = target !== null && target !== 'stamp' && target !== 'signature' && !readOnly;
  const showWidth = target !== null && WIDTH_KINDS.has(target) && !readOnly;
  const showFontSize = target === 'freetext' && !readOnly;

  const chooseTool = (next: Tool) => {
    const store = useAnnotations.getState();
    // Text schon ausgewählt? Dann gleich markieren (wie in Acrobat).
    if (MARKUP_TOOLS.includes(next) && markupSelection(tab.id, next, (page) => cachedGeometry(tab.id, page))) {
      return;
    }
    store.setTool(next === tool && next !== 'select' ? 'select' : next);
    store.select(tab.id, null);
    focusViewer(getRuntime(tab.id));
  };

  const restyle = (patch: Partial<{ color: Rgb; width: number; fontSize: number }>) => {
    if (!selected) return;
    updateAnnotation(tab.id, selected, { ...selected, ...patch } as Annotation);
  };

  const chooseColor = (color: Rgb) => {
    if (!target) return;
    useAnnotations.getState().setColor(target, color);
    restyle({ color });
  };

  const chooseWidth = (value: number) => {
    useAnnotations.getState().setWidth(value);
    if (selected && 'width' in selected) restyle({ width: value });
  };

  const chooseFontSize = (value: number) => {
    useAnnotations.getState().setFontSize(value);
    if (selected?.kind === 'freetext') restyle({ fontSize: value });
  };

  const glassRef = useLiquidGlass<HTMLDivElement>(GLASS.control);

  return (
    <div
      ref={glassRef}
      className={styles.bar}
      role="toolbar"
      aria-label={t('comments.toolbar')}
      data-testid="comment-toolbar"
      data-tone="comment"
      onMouseDown={(event) => {
        // Die Textauswahl im Dokument bleibt erhalten, damit Markieren per Klick funktioniert.
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <ModeBadge tone="comment" icon={MessageSquareIcon} label={t('toolbar.comment')} />
      <div className={styles.group}>
        {TOOLS.map(({ tool: id, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(`tools.${id}`)}
            pressed={tool === id}
            disabled={readOnly && id !== 'select'}
            onClick={() => chooseTool(id)}
            data-testid={`tool-${id}`}
          />
        ))}
      </div>

      {(showColor || showWidth || showFontSize || (tool === 'stamp' && !readOnly)) && <span className={styles.separator} />}

      {showColor && (
        <div className={styles.group} role="radiogroup" aria-label={t('comments.color')}>
          {PALETTE.map(({ id, color }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={currentColor ? rgbEquals(currentColor, color) : false}
              className={styles.swatch}
              style={{ background: toCss(color) }}
              data-tooltip={t(`colors.${id}`)}
              aria-label={t(`colors.${id}`)}
              onClick={() => chooseColor(color)}
              data-testid={`color-${id}`}
            />
          ))}
        </div>
      )}

      {showWidth && (
        <select
          className={styles.select}
          aria-label={t('comments.width')}
          data-tooltip={t('comments.width')}
          value={currentWidth}
          onChange={(event) => chooseWidth(Number(event.target.value))}
          data-testid="width-select"
        >
          {WIDTHS.map((w) => (
            <option key={w} value={w}>
              {t('comments.widthValue', { value: w })}
            </option>
          ))}
        </select>
      )}

      {showFontSize && (
        <select
          className={styles.select}
          aria-label={t('comments.fontSize')}
          data-tooltip={t('comments.fontSize')}
          value={currentFontSize}
          onChange={(event) => chooseFontSize(Number(event.target.value))}
          data-testid="font-size-select"
        >
          {FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {t('comments.fontSizeValue', { value: size })}
            </option>
          ))}
        </select>
      )}

      {tool === 'stamp' && !readOnly && (
        <select
          className={styles.select}
          aria-label={t('comments.stamp')}
          data-tooltip={t('comments.stamp')}
          value={stamp}
          onChange={(event) => useAnnotations.getState().setStamp(event.target.value as StampId)}
          data-testid="stamp-select"
        >
          {STAMP_IDS.map((id) => (
            <option key={id} value={id}>
              {t(`stamps.${id}`)}
            </option>
          ))}
        </select>
      )}

      {readOnly && (
        <span className={styles.notice} data-testid="comments-not-allowed">
          {t('comments.notAllowed')}
        </span>
      )}

      <span className={styles.spacer} />

      <div className={styles.group}>
        <IconButton
          icon={Trash}
          label={t('comments.delete')}
          disabled={!selected || readOnly}
          onClick={() => executeCommand('edit.delete')}
          data-testid="comment-delete"
        />
        <IconButton
          icon={Undo2}
          label={t('comments.undo')}
          disabled={!canUndoState(annotations, history)}
          onClick={() => executeCommand('edit.undo')}
          data-testid="comment-undo"
        />
        <IconButton
          icon={Redo2}
          label={t('comments.redo')}
          disabled={!canRedoState(annotations, history)}
          onClick={() => executeCommand('edit.redo')}
          data-testid="comment-redo"
        />
      </div>
    </div>
  );
}
