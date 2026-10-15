import { Bookmark, LayoutGrid, MessageSquare, Tags, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GLASS, useLiquidGlass } from '../components/glass/liquid-glass';
import { IconButton } from '../components/IconButton';
import { TagsPanel } from '../features/accessibility/TagsPanel';
import { CommentsPanel } from '../features/annotations/CommentsPanel';
import { Outline } from '../features/outline/Outline';
import { Thumbnails } from '../features/thumbnails/Thumbnails';
import { useDocuments, type SidebarTab, type TabState } from '../state/documents-store';
import styles from './Sidebars.module.css';

const PANELS: Array<{ id: SidebarTab; icon: LucideIcon }> = [
  { id: 'pages', icon: LayoutGrid },
  { id: 'bookmarks', icon: Bookmark },
  { id: 'comments', icon: MessageSquare },
  { id: 'tags', icon: Tags },
];

// Seitenleiste als schwebende Glasfläche; der Umschalter schwebt als Glas-Kapsel über dem Inhalt, die Auswahl gleitet
// als helle Kapsel zum gewählten Bereich.
export function LeftSidebar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const updateTab = useDocuments((s) => s.updateTab);
  const panelRef = useLiquidGlass<HTMLElement>(GLASS.panel);
  const switcherRef = useLiquidGlass<HTMLDivElement>(GLASS.control);
  const index = Math.max(0, PANELS.findIndex((panel) => panel.id === tab.sidebarTab));

  return (
    <aside ref={panelRef} className={styles.left} aria-label={t('sidebar.label')} data-testid="left-sidebar">
      <div ref={switcherRef} className={styles.switcher} role="tablist">
        <span className={styles.selection} style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
        {PANELS.map(({ id, icon }) => (
          <IconButton
            key={id}
            icon={icon}
            label={t(`sidebar.${id}`)}
            role="tab"
            aria-selected={tab.sidebarTab === id}
            pressed={tab.sidebarTab === id}
            onClick={() => updateTab(tab.id, { sidebarTab: id })}
            data-testid={`sidebar-${id}`}
          />
        ))}
      </div>
      <div className={styles.content}>
        {tab.sidebarTab === 'pages' && <Thumbnails key={tab.id} tab={tab} />}
        {tab.sidebarTab === 'bookmarks' && <Outline key={tab.id} tab={tab} />}
        {tab.sidebarTab === 'comments' && <CommentsPanel key={tab.id} tab={tab} />}
        {tab.sidebarTab === 'tags' && <TagsPanel key={tab.id} tab={tab} />}
      </div>
    </aside>
  );
}
