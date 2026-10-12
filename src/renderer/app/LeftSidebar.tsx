import { Bookmark, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
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
        <span className={styles.switcherTitle}>
          {tab.sidebarTab === 'pages' ? t('sidebar.pages') : t('sidebar.bookmarks')}
        </span>
      </div>
      <div className={styles.content}>
        {tab.sidebarTab === 'pages' ? <Thumbnails key={tab.id} tab={tab} /> : <Outline key={tab.id} tab={tab} />}
      </div>
    </aside>
  );
}
