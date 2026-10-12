import { Bookmark, LayoutGrid, MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { CommentsPanel } from '../features/annotations/CommentsPanel';
import { Outline } from '../features/outline/Outline';
import { Thumbnails } from '../features/thumbnails/Thumbnails';
import { useDocuments, type TabState } from '../state/documents-store';
import styles from './Sidebars.module.css';

export function LeftSidebar({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const updateTab = useDocuments((s) => s.updateTab);

  return (
    <aside className={styles.left} aria-label={t('sidebar.label')} data-testid="left-sidebar">
      <div className={styles.switcher} role="tablist">
        <IconButton
          icon={LayoutGrid}
          label={t('sidebar.pages')}
          role="tab"
          aria-selected={tab.sidebarTab === 'pages'}
          pressed={tab.sidebarTab === 'pages'}
          onClick={() => updateTab(tab.id, { sidebarTab: 'pages' })}
          data-testid="sidebar-pages"
        />
        <IconButton
          icon={Bookmark}
          label={t('sidebar.bookmarks')}
          role="tab"
          aria-selected={tab.sidebarTab === 'bookmarks'}
          pressed={tab.sidebarTab === 'bookmarks'}
          onClick={() => updateTab(tab.id, { sidebarTab: 'bookmarks' })}
          data-testid="sidebar-bookmarks"
        />
        <IconButton
          icon={MessageSquare}
          label={t('sidebar.comments')}
          role="tab"
          aria-selected={tab.sidebarTab === 'comments'}
          pressed={tab.sidebarTab === 'comments'}
          onClick={() => updateTab(tab.id, { sidebarTab: 'comments' })}
          data-testid="sidebar-comments"
        />
        <span className={styles.switcherTitle}>{t(`sidebar.${tab.sidebarTab}`)}</span>
      </div>
      <div className={styles.content}>
        {tab.sidebarTab === 'pages' && <Thumbnails key={tab.id} tab={tab} />}
        {tab.sidebarTab === 'bookmarks' && <Outline key={tab.id} tab={tab} />}
        {tab.sidebarTab === 'comments' && <CommentsPanel key={tab.id} tab={tab} />}
      </div>
    </aside>
  );
}
