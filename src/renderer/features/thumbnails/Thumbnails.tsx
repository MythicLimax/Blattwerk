import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getRuntime, type DocumentRuntime } from '../../engine/runtime';
import { goToPage } from '../../engine/session';
import type { TabState } from '../../state/documents-store';
import { THUMB_WIDTH } from './thumbnail-cache';
import styles from './Thumbnails.module.css';

const LABEL_HEIGHT = 22;
const ITEM_PADDING = 16;

export function useThumbnail(runtime: DocumentRuntime, pageNumber: number, rotation: number) {
  const subscribe = (notify: () => void) => runtime.thumbnails.subscribe(notify);
  const getSnapshot = () => runtime.thumbnails.get(pageNumber, rotation);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const Thumbnail = memo(function Thumbnail({
  runtime,
  pageNumber,
  rotation,
  aspect,
  current,
  onSelect,
}: {
  runtime: DocumentRuntime;
  pageNumber: number;
  rotation: number;
  aspect: number;
  current: boolean;
  onSelect: (page: number) => void;
}) {
  const { t } = useTranslation();
  const entry = useThumbnail(runtime, pageNumber, rotation);

  // Sichtbare Miniaturen anfordern, beim Herausscrollen wieder abbestellen.
  useEffect(() => {
    if (entry || !runtime.pdf) return;
    runtime.thumbnails.request(runtime.pdf, pageNumber, rotation);
    return () => runtime.thumbnails.cancel(pageNumber, rotation);
  }, [entry, runtime, pageNumber, rotation]);

  const height = entry ? (THUMB_WIDTH * entry.height) / entry.width : THUMB_WIDTH * aspect;
  const label = t('sidebar.thumbnail', { page: pageNumber });

  return (
    <button
      type="button"
      className={[styles.thumb, current ? styles.current : ''].join(' ')}
      onClick={() => onSelect(pageNumber)}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      data-testid="thumbnail"
      data-page={pageNumber}
      data-loaded={entry ? 'true' : 'false'}
    >
      <span className={styles.frame} style={{ width: THUMB_WIDTH, height }}>
        {entry && <img src={entry.url} alt="" width={THUMB_WIDTH} height={height} draggable={false} />}
      </span>
      <span className={styles.label}>{pageNumber}</span>
    </button>
  );
});

export function Thumbnails({ tab }: { tab: TabState }) {
  const runtime = getRuntime(tab.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1.414);

  // Seitenverhältnis der ersten Seite als Schätzung für alle (bis die echte Miniatur da ist).
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

  // TanStack Virtual verträgt sich nicht mit automatischer Memoisierung; die Komponente bleibt bewusst unmemoisiert.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tab.pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => THUMB_WIDTH * aspect + LABEL_HEIGHT + ITEM_PADDING,
    overscan: 4,
  });

  // Aktuelle Seite in der Liste sichtbar halten.
  useEffect(() => {
    virtualizer.scrollToIndex(tab.currentPage - 1, { align: 'auto' });
  }, [tab.currentPage, virtualizer]);

  if (!runtime) return null;

  return (
    <div ref={scrollRef} className={styles.scroller} data-testid="thumbnails">
      <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className={styles.item}
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <Thumbnail
              runtime={runtime}
              pageNumber={item.index + 1}
              rotation={tab.rotation}
              aspect={aspect}
              current={item.index + 1 === tab.currentPage}
              onSelect={(page) => goToPage(tab, page)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
