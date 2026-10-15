import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRect, type Point, type Rect } from '../../../shared/annotations';
import { editUnits, LINE_HEIGHT, missingChars, scalingAbout, translation, type EditUnit, type PageObjectInfo, type PageObjects } from '../../../shared/content';
import type { PageGeometry } from '../../engine/coords';
import { getRuntime } from '../../engine/runtime';
import { useContentEdit, type TextEditing } from '../../state/content-edit-store';
import { addText, baselineBelowClick, editParagraph, editText, reflowText, transformObject } from './actions';
import styles from './ContentEditOverlay.module.css';
import { pageObjects } from './page-objects';

type Gesture =
  | { kind: 'move'; object: EditUnit; origin: Point; dx: number; dy: number }
  | { kind: 'scale'; object: EditUnit; fixed: Point; to: Point }
  // Breite eines Textes ändern (Anfasser links oder rechts); der Text bricht neu um
  | { kind: 'width'; object: EditUnit; side: 'left' | 'right'; to: Point };

const MIN_EDITOR_PX = 11;
// Rahmen (1 px) und Innenabstand (2 px) der Eingabe links: So beginnt der Text genau an der Klickstelle
const EDITOR_INSET_PX = 3;
const pxToUnits = (px: number, scale: number) => px / (scale * (96 / 72));
// Schmalste Breite eines Textes beim Ziehen: zwei Schriftgrößen
const minTextWidth = (object: PageObjectInfo) => 2 * (object.visualSize ?? object.fontSize ?? 12);

// Die Seite wird ungedreht angezeigt (x der Seite läuft nach rechts): nur dann gibt es Anfasser für die Breite
// vorhandener Texte, deren Ränder im PDF links und rechts liegen.
export function isUprightView(geometry: PageGeometry): boolean {
  const [x0, y0] = geometry.toView({ x: 0, y: 0 });
  const [x1, y1] = geometry.toView({ x: 1, y: 0 });
  return x1 > x0 && Math.abs(y1 - y0) < 1e-6;
}

// Leiste „Inhalt bearbeiten“: Klicks dort beenden die Texteingabe nicht (Größe, Schrift, Farbe wirken auf sie)
const inToolbar = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[data-testid="content-edit-toolbar"], [data-testid="content-size-list"]') !== null;

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
  if (gesture.kind === 'width') {
    const min = minTextWidth(object);
    return gesture.side === 'left' ? [Math.min(gesture.to.x, r - min), b, r, t] : [l, b, Math.max(gesture.to.x, l + min), t];
  }
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
  // Dokumentstand, zu dem listing gehört (nach einer Änderung kommt die neue Liste erst etwas später)
  const [listingSource, setListingSource] = useState<unknown>(null);
  // Vorschau nach dem Loslassen, bis der neu gesetzte Text geladen ist (kein kurzes Aufblitzen des alten Textes)
  const [afterglow, setAfterglow] = useState<{ unit: EditUnit; bounds: Rect; source: unknown } | null>(null);
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
      if (cancelled) return;
      setListing(result);
      setListingSource(pdf);
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
    store().select(tabId, { pageIndex, index: object.index, members: object.members, unit: object });
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

  const onSidePointerDown = (event: ReactPointerEvent, object: EditUnit, side: 'left' | 'right') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    setGesture({ kind: 'width', object, side, to: toPdf(event) });
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
    if (current.kind === 'width') {
      const [l, , r] = current.object.bounds;
      if (Math.abs(bounds[0] - l) < 0.5 && Math.abs(bounds[2] - r) < 0.5) return;
      setAfterglow({ unit: current.object, bounds, source: pdf });
      void reflowText(tabId, pageIndex, current.object, current.object.text ?? '', { box: { left: bounds[0], right: bounds[2] }, bounds }).then((done) => {
        if (!done) setAfterglow(null);
      });
      return;
    }
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
    store().select(tabId, { pageIndex, index: unit.index, members: unit.members, unit });
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
      ...(unit.color ? { color: unit.color } : {}),
    });
  };

  const handleSize = pxToUnits(8, scale);
  const upright = isUprightView(geometry);
  const objects = useMemo(() => editUnits(listing?.objects ?? [], listing?.fonts), [listing]);

  // Nach dem Neusetzen eines Textes ist er wieder ausgewählt (Größe, Schrift, Farbe lassen sich weiter ändern)
  const reselect = useContentEdit((s) => (s.reselect?.tabId === tabId && s.reselect.pageIndex === pageIndex ? s.reselect : null));
  useEffect(() => {
    if (!reselect || !listing || listing.pageIndex !== pageIndex || listingSource !== pdf) return;
    const { x, y } = reselect.at;
    const unit = objects.find((object) => object.kind === 'text' && object.bounds[0] - 2 <= x && x <= object.bounds[2] && object.bounds[1] <= y && y <= object.bounds[3] + 2);
    if (!unit) return;
    useContentEdit.getState().setReselect(null);
    useContentEdit.getState().select(tabId, { pageIndex, index: unit.index, members: unit.members, unit });
  }, [reselect, listing, listingSource, pdf, objects, tabId, pageIndex]);

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
          // eslint-disable-next-line react-hooks/refs -- Refs werden nur in den Zeiger-Handlern gelesen, nicht beim Zeichnen
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
                {object.kind === 'text' &&
                  object.upright &&
                  upright &&
                  (['left', 'right'] as const).map((side) => {
                    const [l, b, r, top] = bounds;
                    const [x, y] = geometry.toView({ x: side === 'left' ? l : r, y: (b + top) / 2 });
                    return (
                      <rect
                        key={side}
                        className={styles.sideHandle}
                        x={x - handleSize / 2}
                        y={y - handleSize}
                        width={handleSize}
                        height={handleSize * 2}
                        onPointerDown={(event) => onSidePointerDown(event, object, side)}
                        data-testid={`content-width-${side}`}
                      />
                    );
                  })}
              </g>
            );
          })}
      </svg>
      {(() => {
        // Live-Vorschau beim Ziehen der Breite: der Text bricht sofort in der neuen Breite um
        const live =
          gesture?.kind === 'width'
            ? { unit: gesture.object, bounds: previewBounds(gesture.object, gesture) }
            : afterglow && afterglow.source === listingSource
              ? afterglow
              : null;
        return live ? <WidthPreview unit={live.unit} bounds={live.bounds} geometry={geometry} scale={scale} listing={listing} /> : null;
      })()}
      {editing && <TextEditor editing={editing} geometry={geometry} scale={scale} listing={listing} />}
    </>
  );
}

// Vorschau eines Textes in neuer Breite: deckt den bisherigen Text ab und zeigt den Text mit einer ähnlichen Schrift
// umbrochen. Endgültig setzt ihn danach PDFium mit den echten Zeichenbreiten.
function WidthPreview({ unit, bounds, geometry, scale, listing }: { unit: EditUnit; bounds: Rect; geometry: PageGeometry; scale: number; listing: PageObjects | null }) {
  const viewScale = scale * (96 / 72);
  const size = unit.visualSize ?? unit.fontSize ?? 12;
  const lines = unit.lines?.length ?? 1;
  // Zeilenabstand wie im Absatz (aus Höhe und Zeilenzahl), sonst 1,2
  const step = lines > 1 ? Math.max(size, (unit.bounds[3] - unit.bounds[1] - size) / (lines - 1)) : size * LINE_HEIGHT;
  const old = geometry.rectToView(unit.bounds);
  const box = geometry.rectToView(bounds);
  const color = unit.color;
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;
  return (
    <>
      <div
        className={styles.previewMask}
        style={{ left: percent(old.x, geometry.width), top: percent(old.y, geometry.height), width: percent(old.w, geometry.width), height: percent(old.h, geometry.height) }}
      />
      <div
        className={styles.preview}
        style={{
          left: percent(box.x, geometry.width),
          top: percent(box.y, geometry.height),
          width: percent(box.w, geometry.width),
          fontSize: `${size * viewScale}px`,
          lineHeight: `${step * viewScale}px`,
          ...lookOf(listing?.fonts[unit.font ?? '']?.name ?? ''),
          color: color ? `rgb(${color.r * 255} ${color.g * 255} ${color.b * 255})` : undefined,
        }}
        data-testid="content-width-preview"
      >
        {unit.text}
      </div>
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewScale = scale * (96 / 72);
  // Vom Nutzer gezogene Breite (Ansichtseinheiten = Punkt); null = wie vorgegeben
  const [frame, setFrame] = useState<{ left: number; width: number } | null>(null);
  const resizable = editing.mode === 'new' || isUprightView(geometry);
  const restyle = editing.mode === 'edit' ? editing.style : undefined;

  // Bei kleinem Zoom bleibt die Eingabe lesbar, auch wenn sie dann etwas größer ist als der Text auf der Seite.
  const pointSize = editing.mode === 'edit' ? (restyle?.size ?? editing.fontSize) : style.size;
  const fontSize = Math.max(MIN_EDITOR_PX, pointSize * viewScale);
  // Neuer Text: Eingabe so legen, dass der Text an der Klickstelle beginnt und die erste Zeile mittig auf ihr liegt
  const box =
    editing.mode === 'edit'
      ? geometry.rectToView(editing.bounds)
      : { x: editing.at.x - EDITOR_INSET_PX / viewScale, y: editing.at.y - (fontSize * LINE_HEIGHT) / 2 / viewScale - 1 / viewScale, w: 0, h: 0 };
  const left = frame?.left ?? box.x;

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
    if (editing.mode === 'edit' && (frame || (restyle && Object.keys(restyle).length > 0))) {
      // Neue Breite oder Gestaltung: Zeile bzw. Absatz neu setzen (bricht in der Breite um)
      const y = box.y;
      const change = {
        ...(frame ? { box: { left: geometry.toPdf(frame.left, y).x, right: geometry.toPdf(frame.left + frame.width, y).x } } : {}),
        ...(restyle ? { style: restyle } : {}),
      };
      const unit = { index: editing.index, members: [editing.index, ...editing.merge], bounds: editing.bounds, ...(editing.lines ? { lines: editing.lines } : {}) };
      void reflowText(editing.tabId, editing.pageIndex, unit, value, change);
    } else if (editing.mode === 'edit' && editing.lines) {
      void editParagraph(editing.tabId, editing.pageIndex, editing.lines, value, initial);
    } else if (editing.mode === 'edit') {
      void editText(editing.tabId, editing.pageIndex, editing.index, editing.merge, value, initial);
    } else {
      // Text beginnt dort, wo die Eingabe steht (auch nach Ziehen am linken Rand)
      const baseline = geometry.toPdf(editing.at.x + (left - box.x), editing.at.y + baselineBelowClick(style.size));
      const width = frame ? frame.width - (2 * EDITOR_INSET_PX) / viewScale : undefined;
      void addText(editing.tabId, editing.pageIndex, baseline, value, width);
    }
  };

  // Ein Klick irgendwo außerhalb der Eingabe übernimmt den Text, auch auf ein anderes Objekt (dessen Ziehen sonst
  // den Fokus in der Eingabe hält) oder in die Werkzeugleiste. Der Klick wirkt danach wie gewohnt weiter.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapRef.current?.contains(event.target)) return;
      if (inToolbar(event.target)) return;
      commitRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const cancel = () => {
    done.current = true;
    useContentEdit.getState().setEditing(null);
  };

  const paragraph = editing.mode === 'edit' && editing.lines !== undefined;

  // Breite ziehen: Anfasser links und rechts der Eingabe
  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    const wrap = wrapRef.current;
    const container = wrap?.offsetParent;
    if (!wrap || !container || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const pxPerUnit = container.getBoundingClientRect().width / geometry.width;
    const startX = event.clientX;
    const startLeft = left;
    const startWidth = wrap.getBoundingClientRect().width / pxPerUnit;
    const min = (2 * fontSize) / viewScale;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - startX) / pxPerUnit;
      if (side === 'right') setFrame({ left: startLeft, width: Math.max(min, startWidth + dx) });
      else {
        const width = Math.max(min, startWidth - dx);
        setFrame({ left: startLeft + startWidth - width, width });
      }
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      ref.current?.focus({ preventScroll: true });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

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

  const fixedWidth = frame?.width ?? (paragraph ? box.w : null);
  const position = {
    left: `${(left / geometry.width) * 100}%`,
    top: `${(box.y / geometry.height) * 100}%`,
    // Feste Breite (Absatz oder gezogen): die Eingabe bricht um wie später der Text auf der Seite
    ...(fixedWidth !== null
      ? { width: `${(fixedWidth / geometry.width) * 100}%`, whiteSpace: 'normal' as const }
      : { minWidth: editing.mode === 'edit' ? `${(box.w / geometry.width) * 100}%` : `${12 * fontSize}px` }),
  };
  const textColor = editing.mode === 'new' ? style.color : (restyle?.color ?? editing.color);
  const family = editing.mode === 'new' ? style.font : (restyle?.font ?? font?.name ?? '');

  return (
    <div ref={wrapRef} className={styles.editorWrap} style={position}>
      <textarea
        ref={ref}
        className={[styles.editor, fixedWidth !== null ? styles.paragraph : ''].join(' ')}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: 1.2,
          ...lookOf(family),
          color: textColor ? `rgb(${textColor.r * 255} ${textColor.g * 255} ${textColor.b * 255})` : undefined,
        }}
        rows={editing.mode === 'edit' && fixedWidth === null ? 1 : Math.max(1, value.split('\n').length)}
        value={value}
        aria-label={t('contentEdit.textInput')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => {
          // Größe, Schrift oder Farbe in der Leiste wählen beendet die Eingabe nicht
          if (!inToolbar(event.relatedTarget)) commit();
        }}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        data-testid="content-text-editor"
      />
      {resizable &&
        (['left', 'right'] as const).map((side) => (
          <div
            key={side}
            className={[styles.editorHandle, side === 'left' ? styles.editorHandleLeft : styles.editorHandleRight].join(' ')}
            // eslint-disable-next-line react-hooks/refs -- liest Refs erst beim Ziehen, nicht beim Zeichnen
            onPointerDown={(event) => onHandleDown(event, side)}
            onMouseDown={(event) => event.preventDefault()}
            data-testid={`content-editor-width-${side}`}
          />
        ))}
      {(impossible || missing) && (
        <p className={styles.warning} role="status" data-testid="content-font-warning">
          {impossible ? t('contentEdit.impossible', { chars: impossible }) : t('contentEdit.substitute', { chars: missing })}
        </p>
      )}
    </div>
  );
}
