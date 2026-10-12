import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { getRuntime, type DocumentRuntime } from '../../engine/runtime';
import type { TabState } from '../../state/documents-store';
import styles from './Outline.module.css';

// Lesezeichen (Inhaltsverzeichnis) aus dem PDF, wie pdf.js sie liefert.
export interface OutlineNode {
  title: string;
  bold?: boolean;
  italic?: boolean;
  dest?: string | unknown[] | null;
  url?: string | null;
  action?: string | null;
  count?: number;
  items: OutlineNode[];
}

function activate(runtime: DocumentRuntime, node: OutlineNode): void {
  if (node.dest) {
    void runtime.linkService.goToDestination(node.dest as string);
  } else if (node.url) {
    void api.openExternal(node.url);
  } else if (node.action) {
    runtime.linkService.executeNamedAction(node.action);
  }
}

function OutlineItem({ runtime, node, depth }: { runtime: DocumentRuntime; node: OutlineNode; depth: number }) {
  const { t } = useTranslation();
  // In PDFs bedeutet ein negativer Zähler: Eintrag ist anfangs zugeklappt.
  const [open, setOpen] = useState((node.count ?? 0) >= 0 && depth < 1);
  const hasChildren = node.items.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-level={depth + 1}>
      <div className={styles.row} style={{ paddingLeft: 4 + depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className={styles.toggle}
            aria-label={open ? t('sidebar.collapse') : t('sidebar.expand')}
            onClick={() => setOpen(!open)}
          >
            <Chevron size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className={styles.spacer} />
        )}
        <button
          type="button"
          className={styles.title}
          style={{ fontWeight: node.bold ? 600 : undefined, fontStyle: node.italic ? 'italic' : undefined }}
          title={node.title}
          onClick={() => activate(runtime, node)}
          data-testid="outline-item"
        >
          {node.title}
        </button>
      </div>
      {hasChildren && open && (
        <ul role="group" className={styles.list}>
          {node.items.map((child, index) => (
            <OutlineItem key={index} runtime={runtime} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Outline({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const runtime = getRuntime(tab.id);
  const [outline, setOutline] = useState<OutlineNode[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void runtime?.pdf
      ?.getOutline()
      .then((result) => {
        if (!cancelled) setOutline((result as OutlineNode[] | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setOutline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  if (!runtime) return null;
  if (outline === undefined) return <p className={styles.empty}>{t('sidebar.loadingOutline')}</p>;
  if (!outline || outline.length === 0) return <p className={styles.empty}>{t('sidebar.noOutline')}</p>;

  return (
    <div className={styles.scroller} data-testid="outline">
      <ul role="tree" className={styles.list} aria-label={t('sidebar.bookmarks')}>
        {outline.map((node, index) => (
          <OutlineItem key={index} runtime={runtime} node={node} depth={0} />
        ))}
      </ul>
    </div>
  );
}
