import {
  Check,
  ChevronDown,
  ImagePlus,
  MousePointer2,
  Redo2,
  Trash,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { addImage, reflowText, toggleContentEditing } from './actions';
import type { ParagraphStyle } from '../../../shared/content';

// Größe, Schrift oder Farbe gewählt: gilt für die Texteingabe, sonst für den ausgewählten Text, immer auch für neuen Text
function applyStyle(tab: TabState, patch: ParagraphStyle): void {
  const store = useContentEdit.getState();
  store.setStyle(patch);
  const editing = store.editing?.tabId === tab.id ? store.editing : null;
  if (editing) {
    if (editing.mode === 'edit')
      store.setEditing({ ...editing, style: { ...editing.style, ...patch } });
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>('[data-testid="content-text-editor"]')
        ?.focus({ preventScroll: true }),
    );
    return;
  }
  const selected = store.selected[tab.id];
  const unit = selected?.unit;
  if (selected && unit?.kind === 'text' && !tab.working)
    void reflowText(tab.id, selected.pageIndex, unit, unit.text ?? '', { style: patch });
}

const sameColor = (a: Rgb | undefined, b: Rgb) =>
  a !== undefined && Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 0.03;

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
const toCss = ({ r, g, b }: Rgb) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

// Werkzeugleiste im Modus „Inhalt bearbeiten“
export function ContentEditToolbar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const tool = useContentEdit((s) => s.tool);
  const style = useContentEdit((s) => s.style);
  const selected = useContentEdit((s) => s.selected[tab.id] ?? null);
  const editing = useContentEdit((s) => (s.editing?.tabId === tab.id ? s.editing : null));
  // Angezeigt wird die Gestaltung des bearbeiteten oder ausgewählten Textes, sonst die Vorgabe für neuen Text
  const unit = !editing && selected?.unit?.kind === 'text' ? selected.unit : null;
  const shown =
    editing?.mode === 'edit'
      ? {
          size: editing.style?.size ?? editing.fontSize,
          font: editing.style?.font ?? null,
          color: editing.style?.color ?? editing.color,
        }
      : unit
        ? { size: unit.visualSize ?? unit.fontSize ?? style.size, font: null, color: unit.color }
        : { size: style.size, font: style.font as StampFont | null, color: style.color };
  // Eine Nachkommastelle reicht (z. B. 10,5 pt)
  const shownSize = Math.round(shown.size * 10) / 10;
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
        value={shown.font ?? ''}
        aria-label={t('contentEdit.font')}
        data-tooltip={t('contentEdit.font')}
        onChange={(event) => {
          if (event.target.value) applyStyle(tab, { font: event.target.value as StampFont });
        }}
        data-testid="content-font"
      >
        {shown.font === null && <option value={''}>{t('contentEdit.originalFont')}</option>}
        {STAMP_FONTS.map((font) => (
          <option key={font} value={font}>
            {t(`stamp.fonts.${font}`)}
          </option>
        ))}
      </select>
      <SizeField
        value={shownSize}
        label={t('contentEdit.size')}
        unit={t('contentEdit.points')}
        onChange={(size) => applyStyle(tab, { size })}
      />
      <div className={styles.group} role="radiogroup" aria-label={t('contentEdit.color')}>
        {COLORS.map(({ id, color }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={sameColor(shown.color, color)}
            className={styles.swatch}
            style={{ background: toCss(color) }}
            data-tooltip={t(`stamp.colors.${id}`)}
            aria-label={t(`stamp.colors.${id}`)}
            onClick={() => applyStyle(tab, { color })}
            data-testid={`content-color-${id}`}
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
      <span className={styles.notice}>
        {tool === 'text' ? t('contentEdit.textHint') : t('contentEdit.selectHint')}
      </span>
      <span className={styles.spacer} />
      <div className={styles.group}>
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
        <IconButton
          icon={Check}
          label={t('contentEdit.done')}
          onClick={() => toggleContentEditing(tab)}
          data-testid="content-edit-done"
        />
      </div>
    </div>
  );
}

const MIN_SIZE = 1;
const MAX_SIZE = 500;

// Schriftgröße als Kombifeld: Zahl eintippen (auch Nachkommastellen, übernommen mit der Eingabetaste oder beim
// Verlassen des Feldes) oder über den Pfeil aus den üblichen Größen wählen.
function SizeField({
  value,
  label,
  unit,
  onChange,
}: {
  value: number;
  label: string;
  unit: string;
  onChange: (size: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // Offene Liste mit ihrer Lage im Fenster (die Leiste scrollt seitlich und würde sie sonst abschneiden)
  const [open, setOpenState] = useState<{ left: number; top: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open !== null) : next;
    const box = rootRef.current?.getBoundingClientRect();
    setOpenState(value && box ? { left: box.left, top: box.bottom + 2, width: box.width } : null);
  };
  const shown = text ?? String(value).replace('.', ',');

  // Klick außerhalb schließt die Liste
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="content-size-list"]')
      )
        return;
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target))
        setOpenState(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const apply = (raw: string) => {
    setText(null);
    setOpen(false);
    const size = Math.round(Number(raw.replace(',', '.').trim()) * 10) / 10;
    if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE || size === value) return;
    onChange(size);
  };

  return (
    <div ref={rootRef} className={styles.sizeField} data-tooltip={label}>
      <input
        className={styles.sizeInput}
        inputMode="decimal"
        value={shown}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply(event.currentTarget.value);
          } else if (event.key === 'Escape') {
            setText(null);
            setOpen(false);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onBlur={(event) => {
          if (text !== null) apply(event.currentTarget.value);
        }}
        data-testid="content-size"
      />
      <span className={styles.sizeUnit}>{unit}</span>
      <button
        type="button"
        className={styles.sizeToggle}
        aria-label={label}
        aria-expanded={open !== null}
        // Fokus bleibt in der Texteingabe auf der Seite
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
        data-testid="content-size-toggle"
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <ul
            className={styles.sizeList}
            style={{ left: open.left, top: open.top, minWidth: open.width }}
            role="listbox"
            aria-label={label}
            data-testid="content-size-list"
          >
            {SIZES.map((size) => (
              <li
                key={size}
                role="option"
                aria-selected={size === value}
                className={size === value ? styles.sizeOptionCurrent : styles.sizeOption}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(String(size))}
                data-size={size}
              >
                {size} {unit}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
