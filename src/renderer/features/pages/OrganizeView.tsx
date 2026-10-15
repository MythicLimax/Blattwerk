import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  FileOutput,
  FilePlus,
  LayoutGrid,
  ListChecks,
  RotateCcw,
  RotateCw,
  Scissors,
  SquarePlus,
  Trash,
} from 'lucide-react';
import { memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { markDropHandled } from '../../app/hooks';
import { IconButton } from '../../components/IconButton';
import { ModeBadge } from '../../components/ModeBadge';
import { executeCommand } from '../../engine/session';
import { getRuntime, type DocumentRuntime } from '../../engine/runtime';
import { useDocuments, type TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { useThumbnail } from '../thumbnails/Thumbnails';
import { deletePages, insertSources, loadSources, movePages, rotatePages } from './actions';
import { toggleOrganize } from './commands';
import styles from './OrganizeView.module.css';

const CELL_WIDTH = 168;
const THUMB_WIDTH = 140;
const LABEL_HEIGHT = 26;
const GAP = 16;
const PAGE_DRAG_TYPE = 'application/x-blattwerk-pages';

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

const PageCell = memo(function PageCell({
  runtime,
  index,
  rotation,
  aspect,
  selected,
  draggable,
  dropBefore,
  dropAfter,
  onPointerSelect,
  onOpen,
  onDragStart,
  onDragOverCell,
  onRotate,
  onDelete,
}: {
  runtime: DocumentRuntime;
  index: number;
  rotation: number;
  aspect: number;
  selected: boolean;
  draggable: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onPointerSelect: (index: number, event: MouseEvent) => void;
  onOpen: (index: number) => void;
  onDragStart: (index: number, event: DragEvent) => void;
  onDragOverCell: (index: number, event: DragEvent) => void;
  onRotate: (index: number, delta: 90 | 270) => void;
  onDelete: (index: number) => void;
}) {
  const { t } = useTranslation();
  const entry = useThumbnail(runtime, index + 1, rotation);

  useEffect(() => {
    if (entry || !runtime.pdf) return;
    runtime.thumbnails.request(runtime.pdf, index + 1, rotation);
    return () => runtime.thumbnails.cancel(index + 1, rotation);
  }, [entry, runtime, index, rotation]);

  const height = entry ? (THUMB_WIDTH * entry.height) / entry.width : THUMB_WIDTH * aspect;
  return (
    <div
      className={[styles.cell, selected ? styles.selected : '', dropBefore ? styles.dropBefore : '', dropAfter ? styles.dropAfter : ''].join(' ')}
      role="option"
      aria-selected={selected}
      aria-label={t('organize.page', { page: index + 1 })}
      draggable={draggable}
      onMouseDown={(event) => onPointerSelect(index, event)}
      onDoubleClick={() => onOpen(index)}
      onDragStart={(event) => onDragStart(index, event)}
      onDragOver={(event) => onDragOverCell(index, event)}
      data-testid="organize-page"
      data-page={index + 1}
    >
      <div className={styles.frame} style={{ width: THUMB_WIDTH, height }}>
        {entry && <img src={entry.url} alt="" width={THUMB_WIDTH} height={height} draggable={false} />}
        {draggable && (
          <div className={styles.hoverTools} onMouseDown={(event) => event.stopPropagation()}>
            <IconButton icon={RotateCcw} size={14} label={t('organize.rotateLeft')} onClick={() => onRotate(index, 270)} />
            <IconButton icon={RotateCw} size={14} label={t('organize.rotateRight')} onClick={() => onRotate(index, 90)} />
            <IconButton icon={Trash} size={14} label={t('organize.delete')} onClick={() => onDelete(index)} />
          </div>
        )}
      </div>
      <span className={styles.label}>{index + 1}</span>
    </div>
  );
});

// Raster „Seiten organisieren“: alle Seiten als Miniaturen, auswählen, umsortieren, drehen, löschen, einfügen.
export function OrganizeView({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const runtime = getRuntime(tab.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [aspect, setAspect] = useState(1.414);
  const [dropIndex, setDropIndexState] = useState<number | null>(null);
  // Zusätzlich sofort festhalten: Das Loslassen kann vor dem nächsten Neuzeichnen kommen.
  const dropIndexRef = useRef<number | null>(null);
  const setDropIndex = (value: number | null) => {
    dropIndexRef.current = value;
    setDropIndexState(value);
  };
  const anchor = useRef<number | null>(null);
  const draggedPages = useRef<number[] | null>(null);
  const update = useDocuments((s) => s.updateTab);
  const selection = tab.pageSelection;
  const editable = tab.canAssemble && !tab.working;

  // Spaltenzahl aus der Breite
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setColumns(Math.max(1, Math.floor((element.clientWidth - GAP) / (CELL_WIDTH + GAP)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Seitenverhältnis der ersten Seite als Schätzung, bis die Miniaturen da sind
  useEffect(() => {
    let cancelled = false;
    void runtime?.pdf?.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1, rotation: tab.rotation + page.rotate });
      if (!cancelled) setAspect(viewport.height / viewport.width);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, tab.rotation]);

  const rows = Math.ceil(tab.pageCount / columns);
  const rowHeight = THUMB_WIDTH * Math.max(aspect, 1 / aspect) + LABEL_HEIGHT + GAP + 12;
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  });

  // Erste ausgewählte Seite sichtbar halten (z. B. nach Einfügen oder Verschieben)
  const firstSelected = selection.length > 0 ? Math.min(...selection) : null;
  useEffect(() => {
    if (firstSelected !== null) virtualizer.scrollToIndex(Math.floor(firstSelected / columns), { align: 'auto' });
  }, [firstSelected, columns, virtualizer]);

  const setSelection = (pages: number[]) => update(tab.id, { pageSelection: [...new Set(pages)].sort((a, b) => a - b) });

  const onPointerSelect = (index: number, event: MouseEvent) => {
    if (event.button !== 0) return;
    scrollRef.current?.focus({ preventScroll: true });
    if (event.shiftKey && anchor.current !== null) {
      const from = Math.min(anchor.current, index);
      const to = Math.max(anchor.current, index);
      setSelection(Array.from({ length: to - from + 1 }, (_, i) => from + i));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      anchor.current = index;
      setSelection(selection.includes(index) ? selection.filter((p) => p !== index) : [...selection, index]);
      return;
    }
    anchor.current = index;
    // Auf eine bereits ausgewählte Seite klicken behält die Auswahl (zum Ziehen mehrerer Seiten).
    if (!selection.includes(index)) setSelection([index]);
  };

  const openPage = (index: number) => {
    update(tab.id, { pageSelection: [index] });
    toggleOrganize({ ...tab, pageSelection: [index] });
  };

  const onDragStart = (index: number, event: DragEvent) => {
    if (!editable) {
      event.preventDefault();
      return;
    }
    const pages = selection.includes(index) ? selection : [index];
    if (!selection.includes(index)) setSelection([index]);
    draggedPages.current = pages;
    event.dataTransfer.setData(PAGE_DRAG_TYPE, JSON.stringify(pages));
    event.dataTransfer.effectAllowed = 'move';
  };

  const accepts = (event: DragEvent) =>
    editable && (Array.from(event.dataTransfer.types).includes(PAGE_DRAG_TYPE) || hasFiles(event));

  // Einfügestelle: vor oder nach der Seite, je nachdem, über welcher Hälfte der Zeiger steht
  const onDragOverCell = (index: number, event: DragEvent) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDropIndex(event.clientX < rect.left + rect.width / 2 ? index : index + 1);
    event.dataTransfer.dropEffect = hasFiles(event) ? 'copy' : 'move';
    if (hasFiles(event)) useUi.getState().setFileDropInsert(true);
  };

  const onDragOverGrid = (event: DragEvent) => {
    if (!accepts(event)) return;
    event.preventDefault();
    // Unterhalb der letzten Seite: ans Ende
    if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.gridFill !== undefined) setDropIndex(tab.pageCount);
    if (hasFiles(event)) useUi.getState().setFileDropInsert(true);
  };

  const onDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropIndex(null);
      useUi.getState().setFileDropInsert(false);
    }
  };

  const onDrop = (event: DragEvent) => {
    const at = dropIndexRef.current;
    setDropIndex(null);
    useUi.getState().setFileDropInsert(false);
    if (!accepts(event) || at === null) return;
    event.preventDefault();
    markDropHandled(event.nativeEvent);
    if (hasFiles(event)) {
      const files = Array.from(event.dataTransfer.files);
      void (async () => {
        const registered = [];
        for (const file of files) {
          const result = await api.registerDroppedFile(file);
          if (result.ok) registered.push(result.file);
          else useUi.getState().notify(t('pages.errors.rejected', { names: file.name }));
        }
        if (registered.length === 0) return;
        const sources = await loadSources(registered);
        const current = useDocuments.getState().tabs.find((x) => x.id === tab.id);
        if (sources && sources.length > 0 && current) await insertSources(current, sources, at);
      })();
      return;
    }
    const pages = draggedPages.current;
    draggedPages.current = null;
    if (pages) void movePages(tab, pages, at);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const current = selection.length > 0 ? (event.shiftKey ? Math.max(...selection) : Math.min(...selection)) : 0;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (event.key in step) {
      event.preventDefault();
      event.stopPropagation();
      const next = Math.max(0, Math.min(tab.pageCount - 1, current + (step[event.key] ?? 0)));
      anchor.current = next;
      setSelection([next]);
    } else if (event.key === 'Enter' && selection.length > 0) {
      event.preventDefault();
      openPage(Math.min(...selection));
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      setSelection([]);
    } else if ((event.key === 'a' || event.key === 'A') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelection(Array.from({ length: tab.pageCount }, (_, i) => i));
    }
  };

  if (!runtime) return null;
  const targets = selection.length > 0 ? selection : [];
  const allSelected = selection.length === tab.pageCount;

  return (
    <div className={styles.view} data-testid="organize-view">
      <div className={styles.toolbar} role="toolbar" aria-label={t('organize.toolbar')} data-tone="pages">
        <IconButton icon={ArrowLeft} label={t('organize.close')} onClick={() => toggleOrganize(tab)} data-testid="organize-close" />
        <ModeBadge tone="pages" icon={LayoutGrid} label={t('toolbar.organize')} />
        <span className={styles.status} data-testid="organize-status">
          {selection.length > 0 ? t('organize.selected', { count: selection.length }) : t('organize.pages', { count: tab.pageCount })}
        </span>
        <span className={styles.separator} />
        <IconButton
          icon={ListChecks}
          label={allSelected ? t('organize.selectNone') : t('organize.selectAll')}
          pressed={allSelected}
          onClick={() => setSelection(allSelected ? [] : Array.from({ length: tab.pageCount }, (_, i) => i))}
          data-testid="organize-select-all"
        />
        <IconButton
          icon={RotateCcw}
          label={t('organize.rotateLeft')}
          disabled={!editable || targets.length === 0}
          onClick={() => void rotatePages(tab, targets, 270)}
          data-testid="organize-rotate-left"
        />
        <IconButton
          icon={RotateCw}
          label={t('organize.rotateRight')}
          disabled={!editable || targets.length === 0}
          onClick={() => void rotatePages(tab, targets, 90)}
          data-testid="organize-rotate-right"
        />
        <IconButton
          icon={Trash}
          label={t('organize.delete')}
          disabled={!editable || targets.length === 0 || targets.length >= tab.pageCount}
          onClick={() => void deletePages(tab, targets)}
          data-testid="organize-delete"
        />
        <span className={styles.separator} />
        <IconButton
          icon={FilePlus}
          label={t('organize.insertFromFile')}
          disabled={!editable}
          onClick={() => executeCommand('pages.insertFromFile')}
          data-testid="organize-insert-file"
        />
        <IconButton
          icon={SquarePlus}
          label={t('organize.insertBlank')}
          disabled={!editable}
          onClick={() => executeCommand('pages.insertBlank')}
          data-testid="organize-insert-blank"
        />
        <span className={styles.separator} />
        <IconButton
          icon={FileOutput}
          label={t('organize.extract')}
          disabled={!tab.canExtract || tab.working}
          onClick={() => executeCommand('pages.extract')}
          data-testid="organize-extract"
        />
        <IconButton
          icon={Scissors}
          label={t('organize.split')}
          disabled={!tab.canExtract || tab.working}
          onClick={() => executeCommand('pages.split')}
          data-testid="organize-split"
        />
        {!tab.canAssemble && <span className={styles.notice}>{t('errors.pages.notAllowed')}</span>}
      </div>
      <div
        ref={scrollRef}
        className={styles.scroller}
        tabIndex={0}
        role="listbox"
        aria-multiselectable="true"
        aria-label={t('organize.label')}
        onKeyDown={onKeyDown}
        onDragOver={onDragOverGrid}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onMouseDown={(event) => {
          // Klick ins Leere hebt die Auswahl auf
          if (event.target === event.currentTarget) setSelection([]);
        }}
        data-testid="organize-grid"
      >
        <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }} data-grid-fill="">
          {virtualizer.getVirtualItems().map((row) => (
            <div key={row.key} className={styles.row} style={{ transform: `translateY(${row.start}px)`, gap: GAP }} data-grid-fill="">
              {Array.from({ length: columns }, (_, column) => row.index * columns + column)
                .filter((index) => index < tab.pageCount)
                .map((index) => (
                  <PageCell
                    key={index}
                    runtime={runtime}
                    index={index}
                    rotation={tab.rotation}
                    aspect={aspect}
                    selected={selection.includes(index)}
                    draggable={editable}
                    dropBefore={dropIndex === index}
                    dropAfter={dropIndex === tab.pageCount && index === tab.pageCount - 1}
                    onPointerSelect={onPointerSelect}
                    onOpen={openPage}
                    onDragStart={onDragStart}
                    onDragOverCell={onDragOverCell}
                    onRotate={(page, delta) => void rotatePages(tab, [page], delta)}
                    onDelete={(page) => void deletePages(tab, [page])}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
