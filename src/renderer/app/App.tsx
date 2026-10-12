import { useEffect } from 'react';
import { api } from '../api';
import { handleOpenResult, executeCommand } from '../engine/session';
import { GoToPageDialog } from '../features/goto/GoToPageDialog';
import { PasswordDialog } from '../features/password/PasswordDialog';
import { PrintProgressDialog } from '../features/print/PrintProgressDialog';
import { PropertiesDialog } from '../features/properties/PropertiesDialog';
import { DocumentPane } from '../features/viewer/DocumentPane';
import { useActiveTab, useDocuments } from '../state/documents-store';
import { useUi } from '../state/ui-store';
import { PRODUCT_NAME } from '../../shared/product';
import styles from './App.module.css';
import { DropOverlay } from './DropOverlay';
import { LeftSidebar } from './LeftSidebar';
import { Notices } from './Notices';
import { RightPanel } from './RightPanel';
import { StartScreen } from './StartScreen';
import { TabBar } from './TabBar';
import { Toolbar } from './Toolbar';
import { useFileDrop, useGlobalKeys, useMenuStateSync } from './hooks';

export function App() {
  const tabs = useDocuments((s) => s.tabs);
  const activeId = useDocuments((s) => s.activeId);
  const active = useActiveTab();
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const rightPanelVisible = useUi((s) => s.rightPanelVisible);
  const propertiesTabId = useUi((s) => s.propertiesTabId);
  const goToPageOpen = useUi((s) => s.goToPageOpen);
  const print = useUi((s) => s.print);

  useEffect(() => {
    const offOpened = api.onFileOpened((result) => void handleOpenResult(result));
    const offCommand = api.onMenuCommand((command) => executeCommand(command));
    const refreshRecent = () => void api.recent.list().then((list) => useUi.getState().setRecent(list));
    const offRecent = api.onRecentChanged(refreshRecent);
    refreshRecent();
    api.signalReady();
    return () => {
      offOpened();
      offCommand();
      offRecent();
    };
  }, []);

  useMenuStateSync();
  useGlobalKeys();
  useFileDrop();

  useEffect(() => {
    document.title = active ? `${active.name} – ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [active]);

  const propertiesTab = tabs.find((tab) => tab.id === propertiesTabId);
  const showDocumentChrome = tabs.length > 0 && active !== null;

  return (
    <div className={styles.app}>
      <Toolbar />
      {tabs.length > 0 && <TabBar />}
      <div className={styles.workspace}>
        {!showDocumentChrome ? (
          <StartScreen />
        ) : (
          <>
            {sidebarVisible && active.status === 'ready' && <LeftSidebar tab={active} />}
            <main className={styles.documents}>
              {tabs.map((tab) => (
                <DocumentPane key={tab.id} tab={tab} active={tab.id === activeId} />
              ))}
            </main>
            {rightPanelVisible && active.status === 'ready' && <RightPanel tab={active} />}
          </>
        )}
      </div>
      {active?.status === 'password' && <PasswordDialog key={active.id} tab={active} />}
      {propertiesTab && <PropertiesDialog tab={propertiesTab} />}
      {goToPageOpen && active?.status === 'ready' && <GoToPageDialog tab={active} />}
      {print && <PrintProgressDialog progress={print} />}
      <Notices />
      <DropOverlay />
    </div>
  );
}
