import { Highlighter, Strikethrough, Underline } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../../shared/annotations';
import { COLOR_PANEL_SELECTOR, ColorPicker } from '../../components/ColorPicker';
import { IconButton } from '../../components/IconButton';
import { GLASS, useLiquidGlass } from '../../components/glass/liquid-glass';
import { MARKUP_TOOLS, useAnnotations, type Tool } from '../../state/annotations-store';
import type { TabState } from '../../state/documents-store';
import { cachedGeometry, markupSelection } from './AnnotationLayer';
import styles from './SelectionPopover.module.css';

interface Shown {
  range: Range;
  left: number;
  top: number;
}

// Kleine Leiste über markiertem Text (wie in Vorschau oder Acrobat): Hervorheben in einer Farbe der Palette,
// Unterstreichen, Durchstreichen. Erscheint beim normalen Auswählen von Text, solange kein Markierungswerkzeug aktiv ist.
export function SelectionPopover({ tab, containerRef }: { tab: TabState; containerRef: RefObject<HTMLDivElement | null> }) {
  const { t } = useTranslation();
  const tool = useAnnotations((s) => s.tool);
  const color = useAnnotations((s) => s.colors.highlight);
  const [shown, setShown] = useState<Shown | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const glass = useLiquidGlass<HTMLDivElement>(GLASS.small);
  const enabled = tab.mode === 'view' && tab.canAnnotate && !tab.formEditing && !tab.contentEditing && !tab.working && !MARKUP_TOOLS.includes(tool);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) {
      setShown(null);
      return;
    }
    const update = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !selection.toString().trim()) return setShown(null);
      const range = selection.getRangeAt(0);
      // Nur Text im Dokument (Textebene von pdf.js), nicht in Eingabefeldern
      const start = range.startContainer.parentElement;
      if (!container.contains(range.commonAncestorContainer) || !start?.closest('.textLayer')) return setShown(null);
      const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const first = rects[0];
      if (!first) return setShown(null);
      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      setShown({ range: range.cloneRange(), left: (left + right) / 2, top: first.top });
    };
    // Die Auswahl steht erst nach dem Ereignis fest
    const later = () => setTimeout(update, 0);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey || event.key === 'Shift') later();
    };
    const hide = () => setShown(null);
    // Klick außerhalb der Leiste und der Farbauswahl schließt sie (eine neue Auswahl öffnet sie wieder)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (popoverRef.current?.contains(target) || target.closest(COLOR_PANEL_SELECTOR)) return;
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    container.addEventListener('pointerup', later);
    container.addEventListener('keyup', onKeyUp);
    container.addEventListener('scroll', hide);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', hide);
    return () => {
      container.removeEventListener('pointerup', later);
      container.removeEventListener('keyup', onKeyUp);
      container.removeEventListener('scroll', hide);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', hide);
    };
  }, [enabled, containerRef, tab.id]);

  if (!shown) return null;

  // Gemerkte Auswahl wiederherstellen (ein Klick in die Farbauswahl kann sie aufheben) und markieren
  const apply = (kind: Tool, nextColor?: Rgb) => {
    const store = useAnnotations.getState();
    if (nextColor) store.setColor(kind, nextColor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(shown.range);
    markupSelection(tab.id, kind, (page) => cachedGeometry(tab.id, page));
    setShown(null);
  };

  const top = shown.top > 64 ? shown.top - 50 : shown.top + 28;
  const left = Math.max(8, Math.min(shown.left, window.innerWidth - 8));

  return createPortal(
    <div
      ref={(element) => {
        popoverRef.current = element;
        glass(element);
      }}
      className={styles.popover}
      style={{ top, left }}
      role="toolbar"
      aria-label={t('selection.toolbar')}
      data-testid="selection-popover"
      // Klicks auf Knöpfe heben die Textauswahl nicht auf
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <IconButton icon={Highlighter} tone="comment" label={t('selection.highlight')} onClick={() => apply('highlight')} data-testid="selection-highlight" />
      <ColorPicker
        value={color}
        onChange={(next) => apply('highlight', next)}
        nameOf={(id) => t(`colors.${id}`)}
        label={t('selection.color')}
        testId="selection-color"
        favoriteSet="comment"
      />
      <span className={styles.separator} />
      <IconButton icon={Underline} label={t('selection.underline')} onClick={() => apply('underline')} data-testid="selection-underline" />
      <IconButton icon={Strikethrough} label={t('selection.strikeout')} onClick={() => apply('strikeout')} data-testid="selection-strikeout" />
    </div>,
    document.body,
  );
}
