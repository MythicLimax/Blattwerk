import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Annotation, FreeTextAnnotation, InkAnnotation, Point, Rect } from '../../../shared/annotations';
import { boundsOf, normalizeRect } from '../../../shared/annotations';
import { DRAWING_TOOLS as STORE_DRAWING_TOOLS, useAnnotations, type Tool } from '../../state/annotations-store';
import { useUi } from '../../state/ui-store';
import { useDocuments } from '../../state/documents-store';
import type { PageGeometry } from '../../engine/coords';
import { AnnotationShape, css } from './AnnotationShape';
import { needsAppearance } from './changes';
import {
  addAnnotation,
  baseFields,
  deleteAnnotation,
  setContents,
  updateAnnotation,
} from './controller';
import {
  appendInkStroke,
  createFreeText,
  createInk,
  createLine,
  createNote,
  createShape,
  createSignature,
  createStamp,
  FREETEXT_SIZE,
  SHAPE_SIZE,
  simplifyPath,
} from './create';
import { dragRect, isMovable, isResizable, lineRect, resizeFrom, translate } from './geometry';
import styles from './PageOverlay.module.css';

// Laufende Mausaktion auf der Seite
type Gesture =
  | { kind: 'rect'; tool: 'square' | 'circle' | 'freetext'; from: Point; to: Point }
  | { kind: 'line'; tool: 'line' | 'arrow'; from: Point; to: Point }
  | { kind: 'ink'; points: Point[] }
  | { kind: 'move'; id: string; origin: Point; dx: number; dy: number }
  | { kind: 'resize'; id: string; fixed: Point; to: Point }
  | { kind: 'endpoint'; id: string; which: 'start' | 'end'; to: Point };

// Freihandstriche, die kurz nacheinander entstehen, bilden eine Zeichnung (wie Handschrift).
const INK_MERGE_MS = 1500;
const lastInk = new Map<string, { id: string; pageIndex: number; time: number }>();

// Bildschirmpixel → Einheiten des SVG (PDF-Punkte); pdf.js rechnet 1 Punkt = 96/72 Pixel bei 100 %.
const pxToUnits = (px: number, scale: number) => px / (scale * (96 / 72));

const DRAWING_TOOLS = new Set<Tool>(STORE_DRAWING_TOOLS);

function corners([l, b, r, t]: Rect): Point[] {
  return [
    { x: l, y: b },
    { x: r, y: b },
    { x: r, y: t },
    { x: l, y: t },
  ];
}

// Aktuelle Vorschau eines Kommentars während einer Mausaktion
function preview(a: Annotation, gesture: Gesture | null): Annotation {
  if (!gesture || !('id' in gesture) || gesture.id !== a.id) return a;
  switch (gesture.kind) {
    case 'move':
      return translate(a, gesture.dx, gesture.dy);
    case 'resize':
      return resizeFrom(a, gesture.fixed, gesture.to);
    case 'endpoint': {
      if (a.kind !== 'line' && a.kind !== 'arrow') return a;
      const start = gesture.which === 'start' ? gesture.to : a.start;
      const end = gesture.which === 'end' ? gesture.to : a.end;
      return { ...a, start, end, rect: lineRect(start, end, a.width) };
    }
  }
}

interface PageOverlayProps {
  tabId: string;
  pageIndex: number;
  geometry: PageGeometry;
  items: Annotation[];
  originals: Record<string, Annotation>;
  selectedId: string | null;
  editingId: string | null;
  scale: number;
  readOnly: boolean;
}

export function PageOverlay({
  tabId,
  pageIndex,
  geometry,
  items,
  originals,
  selectedId,
  editingId,
  scale,
  readOnly,
}: PageOverlayProps) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const [gesture, setGestureState] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const tool = useAnnotations((s) => s.tool);
  const drawing = !readOnly && DRAWING_TOOLS.has(tool);
  const markupTool = ['highlight', 'underline', 'strikeout', 'squiggly'].includes(tool);

  const setGesture = (next: Gesture | null) => {
    gestureRef.current = next;
    setGestureState(next);
  };

  // Position des Zeigers in PDF-Punkten
  const toPdf = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    const x = ((event.clientX - box.left) / box.width) * geometry.width;
    const y = ((event.clientY - box.top) / box.height) * geometry.height;
    return geometry.toPdf(x, y);
  };

  // Das angeklickte Element hält den Zeiger bis zum Loslassen. Bewegungen kommen per Bubbling bei der Ebene an,
  // Klick und Doppelklick bleiben beim Element (sonst erreicht ein Doppelklick den Kommentar nicht).
  const capture = (event: ReactPointerEvent) => {
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const store = useAnnotations.getState;

  // Neuen Kommentar mit einem Zeichenwerkzeug beginnen
  const onBackgroundPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drawing || event.button !== 0) return;
    event.preventDefault();
    const at = toPdf(event);
    const { colors, stamp } = store();
    const base = baseFields(pageIndex);
    switch (tool) {
      case 'note': {
        const note = createNote(base, at, colors.note);
        addAnnotation(tabId, note);
        store().setTool('select');
        // Text der Notiz direkt in der Kommentarliste eingeben
        store().setEditing(tabId, note.id);
        openCommentsPanel(tabId);
        return;
      }
      case 'stamp':
        addAnnotation(tabId, createStamp(base, at, stamp, t(`stamps.${stamp}`), colors.stamp));
        store().setTool('select');
        return;
      case 'signature': {
        const signature = store().pendingSignature;
        if (signature) addAnnotation(tabId, createSignature(base, at, signature.image, signature.width, signature.height));
        store().setPendingSignature(null);
        return;
      }
      case 'ink':
        capture(event);
        setGesture({ kind: 'ink', points: [at] });
        return;
      case 'line':
      case 'arrow':
        capture(event);
        setGesture({ kind: 'line', tool, from: at, to: at });
        return;
      case 'square':
      case 'circle':
      case 'freetext':
        capture(event);
        setGesture({ kind: 'rect', tool, from: at, to: at });
        return;
      default:
        return;
    }
  };

  // Kommentar anklicken: auswählen und ggf. verschieben
  const onItemPointerDown = (event: ReactPointerEvent, a: Annotation) => {
    if (event.button !== 0 || drawing || markupTool) return;
    event.stopPropagation();
    event.preventDefault();
    store().select(tabId, a.id);
    if (editingId && editingId !== a.id) store().setEditing(tabId, null);
    if (readOnly || !isMovable(a) || editingId === a.id) return;
    capture(event);
    setGesture({ kind: 'move', id: a.id, origin: toPdf(event), dx: 0, dy: 0 });
  };

  const onHandlePointerDown = (event: ReactPointerEvent, a: Annotation, corner: number) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const points = corners(a.rect);
    const fixed = points[(corner + 2) % 4] as Point;
    capture(event);
    setGesture({ kind: 'resize', id: a.id, fixed, to: toPdf(event) });
  };

  const onEndpointPointerDown = (event: ReactPointerEvent, a: Annotation, which: 'start' | 'end') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    capture(event);
    setGesture({ kind: 'endpoint', id: a.id, which, to: toPdf(event) });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = gestureRef.current;
    if (!current) return;
    const at = toPdf(event);
    switch (current.kind) {
      case 'ink': {
        const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
        const added = coalesced.length > 0 ? coalesced.map((e) => toPdf(e)) : [at];
        setGesture({ ...current, points: [...current.points, ...added] });
        return;
      }
      case 'line':
      case 'rect':
        setGesture({ ...current, to: at });
        return;
      case 'move':
        setGesture({ ...current, dx: at.x - current.origin.x, dy: at.y - current.origin.y });
        return;
      case 'resize':
      case 'endpoint':
        setGesture({ ...current, to: at });
        return;
    }
  };

  const finish = (time: number) => {
    const current = gestureRef.current;
    setGesture(null);
    if (!current) return;
    const { colors, width, fontSize } = store();
    switch (current.kind) {
      case 'ink': {
        const path = simplifyPath(current.points);
        if (path.length < 2) return;
        const last = lastInk.get(tabId);
        const previous = last ? items.find((a) => a.id === last.id) : undefined;
        const now = time;
        if (
          previous?.kind === 'ink' &&
          last?.pageIndex === pageIndex &&
          now - last.time < INK_MERGE_MS &&
          previous.width === width
        ) {
          updateAnnotation(tabId, previous, appendInkStroke(previous, path));
          lastInk.set(tabId, { id: previous.id, pageIndex, time: now });
          return;
        }
        const ink: InkAnnotation = createInk(baseFields(pageIndex), [path], colors.ink, width);
        addAnnotation(tabId, ink);
        lastInk.set(tabId, { id: ink.id, pageIndex, time: now });
        return;
      }
      case 'line':
        addAnnotation(tabId, createLine(baseFields(pageIndex), current.tool, current.from, current.to, colors[current.tool], width));
        store().setTool('select');
        return;
      case 'rect': {
        if (current.tool === 'freetext') {
          const rect = dragRect(current.from, current.to, FREETEXT_SIZE);
          const box = createFreeText(baseFields(pageIndex), rect, colors.freetext, fontSize);
          addAnnotation(tabId, box);
          store().setEditing(tabId, box.id);
        } else {
          const rect = dragRect(current.from, current.to, SHAPE_SIZE);
          addAnnotation(tabId, createShape(baseFields(pageIndex), current.tool, rect, colors[current.tool], width));
        }
        store().setTool('select');
        return;
      }
      default: {
        const before = items.find((a) => a.id === current.id);
        if (!before) return;
        const after = preview(before, current);
        if (current.kind === 'resize') {
          const [l, b, r, t] = after.rect;
          if (r - l < 6 || t - b < 6) return;
        }
        updateAnnotation(tabId, before, after);
      }
    }
  };

  const onDoubleClick = (a: Annotation) => {
    if (readOnly) return;
    store().select(tabId, a.id);
    store().setEditing(tabId, a.id);
    if (a.kind !== 'freetext') openCommentsPanel(tabId);
  };

  // Gerade erstelltes Werkzeug-Rechteck/Linie/Strich als Vorschau
  const draft = gesture ? draftShape(gesture, geometry, store()) : null;
  const handleSize = pxToUnits(8, scale);
  const hitWidth = pxToUnits(10, scale);

  return (
    <svg
      ref={svgRef}
      className={[
        styles.svg,
        drawing ? styles.drawing : '',
        drawing && (tool === 'note' || tool === 'stamp' || tool === 'signature') ? styles.place : '',
        gesture ? styles.capturing : '',
      ].join(' ')}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      onPointerDown={onBackgroundPointerDown}
      // Beim Zeichnen weder Text auswählen noch den Fokus wechseln (sonst verliert ein neues Textfeld ihn sofort)
      onMouseDown={(event) => {
        if (drawing || gestureRef.current) event.preventDefault();
      }}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event.timeStamp)}
      onPointerCancel={() => setGesture(null)}
      data-testid={`annotation-overlay-${pageIndex}`}
      data-annotation-overlay=""
    >
      {items.map((original) => {
        const a = preview(original, gesture);
        const fromFile = original.ref ? originals[original.id] : undefined;
        // Unveränderte vorhandene Kommentare zeichnet pdf.js selbst; hier nur die Klickfläche.
        const drawn = !fromFile || needsAppearance(fromFile, original) || a !== original;
        const editing = editingId === a.id && a.kind === 'freetext';
        return (
          <g key={a.id}>
            {drawn && !editing && <AnnotationShape annotation={a} geometry={geometry} />}
            {!editing && (
              <HitArea
                annotation={a}
                geometry={geometry}
                hitWidth={hitWidth}
                movable={!readOnly && isMovable(a)}
                passive={drawing || markupTool}
                onPointerDown={(event) => onItemPointerDown(event, original)}
                onDoubleClick={() => onDoubleClick(original)}
              />
            )}
            {editing && a.kind === 'freetext' && <FreeTextEditor tabId={tabId} annotation={a} geometry={geometry} />}
          </g>
        );
      })}
      {items
        .filter((a) => a.id === selectedId)
        .map((original) => {
          const a = preview(original, gesture);
          return (
            <SelectionFrame
              key={`selection-${a.id}`}
              annotation={a}
              geometry={geometry}
              handleSize={handleSize}
              readOnly={readOnly || drawing}
              onCornerDown={(event, corner) => onHandlePointerDown(event, original, corner)}
              onEndpointDown={(event, which) => onEndpointPointerDown(event, original, which)}
            />
          );
        })}
      {draft}
    </svg>
  );
}

function openCommentsPanel(tabId: string): void {
  useUi.getState().setSidebarVisible(true);
  useDocuments.getState().updateTab(tabId, { sidebarTab: 'comments' });
}

function draftShape(gesture: Gesture, geometry: PageGeometry, settings: ReturnType<typeof useAnnotations.getState>) {
  const { colors, width } = settings;
  switch (gesture.kind) {
    case 'ink':
      return (
        <polyline
          points={gesture.points.map((p) => geometry.toView(p).join(',')).join(' ')}
          fill="none"
          stroke={css(colors.ink)}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'line': {
      const [x1, y1] = geometry.toView(gesture.from);
      const [x2, y2] = geometry.toView(gesture.to);
      return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={css(colors[gesture.tool])} strokeWidth={width} strokeLinecap="round" />;
    }
    case 'rect': {
      const r = geometry.rectToView(normalizeRect([gesture.from.x, gesture.from.y, gesture.to.x, gesture.to.y]));
      const color = css(colors[gesture.tool]);
      if (gesture.tool === 'circle') {
        return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} fill="none" stroke={color} strokeWidth={width} />;
      }
      return (
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill="none"
          stroke={color}
          strokeWidth={gesture.tool === 'freetext' ? 1 : width}
          strokeDasharray={gesture.tool === 'freetext' ? '4 3' : undefined}
          vectorEffect={gesture.tool === 'freetext' ? 'non-scaling-stroke' : undefined}
        />
      );
    }
    default:
      return null;
  }
}

interface HitAreaProps {
  annotation: Annotation;
  geometry: PageGeometry;
  hitWidth: number;
  movable: boolean;
  passive: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
  onDoubleClick: () => void;
}

// Unsichtbare Klickfläche. Linien und Rahmen reagieren nur auf ihren Strich, damit Text darunter auswählbar bleibt.
function HitArea({ annotation: a, geometry, hitWidth, movable, passive, onPointerDown, onDoubleClick }: HitAreaProps) {
  const className = [styles.hit, movable ? styles.movable : '', passive ? styles.passive : ''].join(' ');
  const common = {
    className,
    onPointerDown,
    onDoubleClick,
    'data-annotation-hit': a.id,
  };
  const points = (list: Point[]) => list.map((p) => geometry.toView(p).join(',')).join(' ');
  switch (a.kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
      return (
        <g {...common}>
          {a.quads.map((q, i) => (
            <polygon key={i} points={points([q[0], q[1], q[3], q[2]])} />
          ))}
        </g>
      );
    case 'ink':
      return (
        <g {...common} strokeWidth={Math.max(hitWidth, a.width)} fill="none">
          {a.paths.map((path, i) => (
            <polyline key={i} points={points(path)} />
          ))}
        </g>
      );
    case 'line':
    case 'arrow':
      return <polyline {...common} points={points([a.start, a.end])} strokeWidth={Math.max(hitWidth, a.width)} fill="none" />;
    case 'square':
    case 'circle': {
      const r = geometry.rectToView(a.rect);
      const filled = Boolean(a.fill);
      const props = { ...common, strokeWidth: Math.max(hitWidth, a.width), fill: filled ? 'transparent' : 'none' };
      return a.kind === 'square' ? (
        <rect {...props} x={r.x} y={r.y} width={r.w} height={r.h} />
      ) : (
        <ellipse {...props} cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} />
      );
    }
    default: {
      const r = geometry.rectToView(a.rect);
      return <rect {...common} x={r.x} y={r.y} width={r.w} height={r.h} />;
    }
  }
}

interface SelectionFrameProps {
  annotation: Annotation;
  geometry: PageGeometry;
  handleSize: number;
  readOnly: boolean;
  onCornerDown: (event: ReactPointerEvent, corner: number) => void;
  onEndpointDown: (event: ReactPointerEvent, which: 'start' | 'end') => void;
}

function SelectionFrame({ annotation: a, geometry, handleSize, readOnly, onCornerDown, onEndpointDown }: SelectionFrameProps) {
  const isLine = a.kind === 'line' || a.kind === 'arrow';
  const frame = geometry.rectToView(isLine ? boundsOf([a.start, a.end]) : a.rect);
  const handle = (p: Point, key: string, onDown: (event: ReactPointerEvent) => void, cursor: string) => {
    const [x, y] = geometry.toView(p);
    return (
      <rect
        key={key}
        className={styles.handle}
        style={{ cursor }}
        x={x - handleSize / 2}
        y={y - handleSize / 2}
        width={handleSize}
        height={handleSize}
        onPointerDown={onDown}
        data-handle={key}
      />
    );
  };
  return (
    <g data-testid="annotation-selection">
      {!isLine && <rect className={styles.frame} x={frame.x} y={frame.y} width={frame.w} height={frame.h} />}
      {!readOnly &&
        isResizable(a) &&
        corners(a.rect).map((p, i) => handle(p, `corner-${i}`, (event) => onCornerDown(event, i), 'nwse-resize'))}
      {!readOnly &&
        isLine && [
          handle(a.start, 'start', (event) => onEndpointDown(event, 'start'), 'crosshair'),
          handle(a.end, 'end', (event) => onEndpointDown(event, 'end'), 'crosshair'),
        ]}
    </g>
  );
}

// Freitext direkt auf der Seite bearbeiten
function FreeTextEditor({ tabId, annotation: a, geometry }: { tabId: string; annotation: FreeTextAnnotation; geometry: PageGeometry }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(a.contents);
  const r = geometry.rectToView(a.rect);
  const done = useRef(false);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(area.value.length, area.value.length);
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const store = useAnnotations.getState();
    if (value.trim() === '') {
      // Leeres Textfeld entfernen: ein gerade angelegtes spurlos, ein älteres als rückgängig machbares Löschen.
      const last = store.tabs[tabId]?.undo.at(-1);
      if (last?.type === 'add' && last.annotation.id === a.id) store.discard(tabId, a.id);
      else deleteAnnotation(tabId, a.id);
    } else {
      setContents(tabId, a.id, value);
    }
    store.setEditing(tabId, null);
  };

  // Auch beim Verschwinden des Editors (z. B. Wechsel ins Seitenraster) den Text übernehmen
  const commitRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => commitRef.current(), []);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      commit();
    }
  };

  return (
    <foreignObject x={r.x} y={r.y} width={r.w} height={r.h}>
      <textarea
        ref={ref}
        className={styles.freeTextEditor}
        style={{ color: css(a.color), fontSize: a.fontSize }}
        value={value}
        aria-label={t('comments.freeTextInput')}
        data-testid="freetext-editor"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </foreignObject>
  );
}
