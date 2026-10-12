import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../components/IconButton';
import { SearchPanel } from '../features/search/SearchPanel';
import type { TabState } from '../state/documents-store';
import { useUi } from '../state/ui-store';
import styles from './Sidebars.module.css';

// Rechtes Werkzeugpanel. In Phase 1 enthält es die Suche; weitere Werkzeuge folgen in späteren Phasen.
export function RightPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const setVisible = useUi((s) => s.setRightPanelVisible);
  return (
    <aside className={styles.right} aria-label={t('search.title')} data-testid="right-panel">
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{t('search.title')}</h2>
        <IconButton icon={X} label={t('search.close')} size={16} onClick={() => setVisible(false)} />
      </div>
      <SearchPanel key={tab.id} tab={tab} />
    </aside>
  );
}
