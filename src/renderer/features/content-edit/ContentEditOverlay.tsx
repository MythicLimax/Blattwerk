import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRect, type Point, type Rect } from '../../../shared/annotations';
import { editUnits, LINE_HEIGHT, missingChars, scalingAbout, translation, type EditUnit, type PageObjectInfo, type PageObjects } from '../../../shared/content';
import type { PageGeometry } from '../../engine/coords';
import { getRuntime } from '../../engine/runtime';
import { useContentEdit, type TextEditing } from '../../state/content-edit-store';
import { addText, baselineBelowClick, editParagraph, editText, transformObject } from './actions';
import styles from './ContentEditOverlay.module.css';
import { pageObjects } from './page-objects';

type Gesture =
  | { kind: 'move'; object: EditUnit; origin: Point; dx: number; dy: number }
  | { kind: 'scale'; object: EditUnit; fixed: Point; to: Point };

const MIN_EDITOR_PX = 11;
// Rahmen (1 px) und Innenabstand (2 px) der Eingabe links: So beginnt der Text genau an der Klickstelle
const EDITOR_INSET_PX = 3;
const pxToUnits = (px: number, scale: number) => px / (scale * (96 / 72));

function corners([l, b, r, t]: Rect): Point[] {
  return [
    { x: l, y: b },
    { x: r, y: b },
    { x: r, y: t },
    { x: l, y: t },
  ];
}

// Gleichmäßiger Faktor beim Ziehen einer Ecke (das Seitenverhältnis bleibt)
function scaleFactor(object: PageObjectInfo, fixed: Point, to: Point): number {
  const [l, b, r, t] = object.bounds;
  const width = Math.max(1, r - l);
  const height = Math.max(1, t - b);
  return Math.max(0.05, Math.max(Math.abs(to.x - fixed.x) / width, Math.abs(to.y - fixed.y) / height));
}

function previewBounds(object: PageObjectInfo, gesture: Gesture | null): Rect {
  if (!gesture || gesture.object.index !== object.index) return object.bounds;
  const [l, b, r, t] = object.bounds;
  if (gesture.kind === 'move') return [l + gesture.dx, b + gesture.dy, r + gesture.dx, t + gesture.dy];
  const f = scaleFactor(object, gesture.fixed, gesture.to);
  const { x, y } = gesture.fixed;
  return normalizeRect([x + (l - x) * f, y + (b - y) * f, x + (r - x) * f, y + (t - y) * f]);
}

interface Props {
  tabId: string;
  pageIndex: number;
  geometry: PageGeometry;
  scale: number;
}

// Text und Bilder einer Seite im Modus „Inhalt bearbeiten“
export function ContentEditOverlay({ tabId, pageIndex, geometry, scale }: Props) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [listing, setListing] = useState<PageObjects | null>(null);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const tool = useContentEdit((s) => s.tool);
  const selected = useContentEdit((s) => s.selected[tabId] ?? null);
  const editing = useContentEdit((s) => (s.editing?.tabId === tabId && s.editing.pageIndex === pageIndex ? s.editing : null));
  const pending = useContentEdit((s) => s.pending[tabId] ?? null);
  const runtime = getRuntime(tabId);
  const pdf = runtime?.pdf ?? null;

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    void pageObjects(pdf, runtime?.password ?? null, pageIndex).then((result) => {
      if (!cancelled) setListing(result);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex, runtime?.password]);

  const setGesture = (next: Gesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };

  const toPdf = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return geometry.toPdf(((event.clientX - box.left) / box.width) * geometry.width, ((event.clientY - box.top) / box.height) * geometry.height);
  };

  const toView = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * geometry.width, y: ((event.clientY - box.top) / box.height) * geometry.height };
  };

  const store = useContentEdit.getState;

  const onBackgroundPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'text' || event.button !== 0 || editing) return;
    event.preventDefault();
    // Neuer Text: Eingabe an der Klickstelle (in der Ansicht, damit sie auch auf gedrehten Seiten aufrecht steht)
    store().setEditing({ tabId, pageIndex, mode: 'new', at: toView(event) });
    store().setTool('select');
  };

  const onObjectPointerDown = (event: ReactPointerEvent, object: EditUnit) => {
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    store().select(tabId, { pageIndex, index: object.index, members: object.members });
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setGesture({ kind: 'move', object, origin: toPdf(event), dx: 0, dy: 0 });
  };

  const onHandlePointerDown = (event: ReactPointerEvent, object: EditUnit, corner: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const points = corners(object.bounds);
    setGesture({ kind: 'scale', object, fixed: points[(corner + 2) % 4] as Point, to: toPdf(event) });
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const current = gestureRef.current;
    if (!current) return;
    const at = toPdf(event);
    if (current.kind === 'move') setGesture({ ...current, dx: at.x - current.origin.x, dy: at.y - current.origin.y });
    else setGesture({ ...current, to: at });
  };

  const finish = () => {
    const current = gestureRef.current;
    setGesture(null);
    if (!current) return;
    const bounds = previewBounds(current.object, current);
    if (current.kind === 'move') {
      if (Math.hypot(current.dx, current.dy) < 0.5) return;
      void transformObject(tabId, pageIndex, current.object.index, current.object.members, translation(current.dx, current.dy), bounds);
      return;
    }
    const factor = scaleFactor(current.object, current.fixed, current.to);
    if (Math.abs(factor - 1) < 0.01) return;
    void transformObject(tabId, pageIndex, current.object.index, current.object.members, scalingAbout(factor, current.fixed.x, current.fixed.y), bounds);
  };

  // Text bearbeiten: immer die ganze Zeile, auch wenn das PDF sie in mehreren Stücken speichert (siehe editUnits)
  const startEdit = (unit: EditUnit) => {
    if (unit.kind !== 'text') return;
    store().select(tabId, { pageIndex, index: unit.index, members: unit.members });
    store().setEditing({
      tabId,
      pageIndex,
      mode: 'edit',
      index: unit.index,
      merge: unit.members.filter((member) => member !== unit.index),
      bounds: unit.bounds,
      text: unit.text ?? '',
      fontSize: unit.visualSize ?? unit.fontSize ?? 12,
      ...(unit.font ? { font: unit.font } : {}),
      ...(unit.lines ? { lines: unit.lines } : {}),
    });
  };

  const handleSize = pxToUnits(8, scale);
  const objects = useMemo(() => editUnits(listing?.objects ?? [], listing?.fonts), [listing]);

  return (
    <>
      <svg
        ref={svgRef}
        className={[styles.svg, tool === 'text' ? styles.creating : '', gesture ? styles.capturing : ''].join(' ')}
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        preserveAspectRatio="none"
        onPointerDown={onBackgroundPointerDown}
        onMouseDown={(event) => {
          if (tool === 'text' || gestureRef.current) event.preventDefault();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={() => setGesture(null)}
        data-testid={`content-edit-overlay-${pageIndex}`}
        data-content-edit-overlay=""
      >
        {objects.map((object) => {
          const moving = pending?.pageIndex === pageIndex && pending.index === object.index ? pending.bounds : null;
          const r = geometry.rectToView(moving ?? previewBounds(object, gesture));
          const isSelected = selected?.pageIndex === pageIndex && selected.index === object.index;
          const hidden = editing?.mode === 'edit' && editing.index === object.index;
          if (hidden) return null;
          return (
            <rect
              key={object.index}
              className={[styles.object, styles[object.kind] ?? '', isSelected ? styles.selected : '', tool !== 'select' ? styles.passive : ''].join(' ')}
              x={r.x}
              y={r.y}
              width={Math.max(r.w, 2)}
              height={Math.max(r.h, 2)}
              onPointerDown={(event) => onObjectPointerDown(event, object)}
              onDoubleClick={() => startEdit(object)}
              data-testid="content-object"
              data-kind={object.kind}
              data-text={object.text}
              data-index={object.index}
            >
              <title>{object.kind === 'text' ? object.text : t(`contentEdit.kinds.${object.kind}`)}</title>
            </rect>
          );
        })}
        {objects
          .filter((object) => selected?.pageIndex === pageIndex && selected.index === object.index && tool === 'select' && !editing)
          .map((object) => {
            const bounds = pending?.index === object.index ? pending.bounds : previewBounds(object, gesture);
            return (
              <g key={`handles-${object.index}`} data-testid="content-selection">
                {corners(bounds).map((p, i) => {
                  const [x, y] = geometry.toView(p);
                  return (
                    <rect
                      key={i}
                      className={styles.handle}
                      x={x - handleSize / 2}
                      y={y - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      onPointerDown={(event) => onHandlePointerDown(event, object, i)}
                      data-handle={`corner-${i}`}
                    />
                  );
                })}
              </g>
            );
          })}
      </svg>
      {editing && <TextEditor editing={editing} geometry={geometry} scale={scale} listing={listing} />}
    </>
  );
}

// Schriftschnitt der Eingabe ähnlich der Schrift der Zeile (fett, mit Serifen, Schreibmaschine)
function lookOf(name: string): { fontWeight: number; fontFamily: string } {
  const lower = name.toLowerCase();
  const fontFamily = /courier|mono/.test(lower) ? 'Courier, monospace' : /times|serif|roman/.test(lower) && !/sans/.test(lower) ? 'Times, serif' : 'Helvetica, Arial, sans-serif';
  return { fontWeight: /bold|black|heavy/.test(lower) ? 700 : 400, fontFamily };
}

// Eingabe für neuen Text oder eine vorhandene Zeile, direkt auf der Seite
function TextEditor({ editing, geometry, scale, listing }: { editing: TextEditing; geometry: PageGeometry; scale: number; listing: PageObjects | null }) {
  const { t } = useTranslation();
  const style = useContentEdit((s) => s.style);
  const initial = editing.mode === 'edit' ? editing.text : '';
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const viewScale = scale * (96 / 72);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  const font = editing.mode === 'edit' && editing.font ? listing?.fonts[editing.font] : undefined;
  const missing = editing.mode === 'edit' ? missingChars(value, font) : missingChars(value, undefined);
  const impossible = missingChars(value, undefined);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    useContentEdit.getState().setEditing(null);
    if (impossible) return;
    if (editing.mode === 'edit' && editing.lines) {
      void editParagraph(editing.tabId, editing.pageIndex, editing.lines, value, initial);
    } else if (editing.mode === 'edit') {
      void editText(editing.tabId, editing.pageIndex, editing.index, editing.merge, value, initial);
    } else {
      const baseline = geometry.toPdf(editing.at.x, editing.at.y + baselineBelowClick(style.size));
      void addText(editing.tabId, editing.pageIndex, baseline, value);
    }
  };

  const cancel = () => {
    done.current = true;
    useContentEdit.getState().setEditing(null);
  };

  const paragraph = editing.mode === 'edit' && editing.lines !== undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && ((editing.mode === 'edit' && !paragraph) || event.metaKey || event.ctrlKey)) {
      // Vorhandene Zeile: Eingabe übernimmt; neuer Text und Absätze: Cmd+Eingabe (Eingabe allein beginnt eine neue Zeile)
      event.preventDefault();
      commit();
    }
  };

  // Bei kleinem Zoom bleibt die Eingabe lesbar, auch wenn sie dann etwas größer ist als der Text auf der Seite.
  const fontSize = Math.max(MIN_EDITOR_PX, (editing.mode === 'edit' ? editing.fontSize : style.size) * viewScale);
  // Neuer Text: Eingabe so legen, dass der Text an der Klickstelle beginnt und die erste Zeile mittig auf ihr liegt
  const box =
    editing.mode === 'edit'
      ? geometry.rectToView(editing.bounds)
      : { x: editing.at.x - EDITOR_INSET_PX / viewScale, y: editing.at.y - (fontSize * LINE_HEIGHT) / 2 / viewScale - 1 / viewScale, w: 0, h: 0 };
  const position = {
    left: `${(box.x / geometry.width) * 100}%`,
    top: `${(box.y / geometry.height) * 100}%`,
    minWidth: editing.mode === 'edit' ? `${(box.w / geometry.width) * 100}%` : `${12 * fontSize}px`,
    // Absatz: feste Breite, die Eingabe bricht um wie später der Absatz
    ...(paragraph ? { width: `${(box.w / geometry.width) * 100}%`, whiteSpace: 'normal' as const } : {}),
  };

  return (
    <div className={styles.editorWrap} style={position}>
      <textarea
        ref={ref}
        className={[styles.editor, paragraph ? styles.paragraph : ''].join(' ')}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: 1.2,
          ...lookOf(editing.mode === 'edit' ? (font?.name ?? '') : style.font),
          color: editing.mode === 'new' ? `rgb(${style.color.r * 255} ${style.color.g * 255} ${style.color.b * 255})` : undefined,
        }}
        rows={editing.mode === 'edit' && !paragraph ? 1 : Math.max(1, value.split('\n').length)}
        value={value}
        aria-label={t('contentEdit.textInput')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        data-testid="content-text-editor"
      />
      {(impossible || missing) && (
        <p className={styles.warning} role="status" data-testid="content-font-warning">
          {impossible ? t('contentEdit.impossible', { chars: impossible }) : t('contentEdit.substitute', { chars: missing })}
        </p>
      )}
    </div>
  );
}
