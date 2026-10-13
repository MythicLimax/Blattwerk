import { useEffect } from 'react';
import { api } from '../api';
import { handleCloseRequest, handleOpenResult, executeCommand } from '../engine/session';
import { CommentToolbar } from '../features/annotations/CommentToolbar';
import { BusyOverlay } from '../features/pages/BusyOverlay';
import { CombineDialog, PageDialogs, SourcePasswordDialog } from '../features/pages/PageDialogs';
import { GoToPageDialog } from '../features/goto/GoToPageDialog';
import { PasswordDialog } from '../features/password/PasswordDialog';
import { PrintProgressDialog } from '../features/print/PrintProgressDialog';
import { PromptDialog } from '../features/prompt/PromptDialog';
import { PropertiesDialog } from '../features/properties/PropertiesDialog';
import { SettingsDialog } from '../features/settings/SettingsDialog';
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
import { useAnnotationSync, useFileDrop, useGlobalKeys, useMenuStateSync } from './hooks';

export function App() {
  const tabs = useDocuments((s) => s.tabs);
  const activeId = useDocuments((s) => s.activeId);
  const active = useActiveTab();
  const sidebarVisible = useUi((s) => s.sidebarVisible);
  const rightPanelVisible = useUi((s) => s.rightPanelVisible);
  const propertiesTabId = useUi((s) => s.propertiesTabId);
  const goToPageOpen = useUi((s) => s.goToPageOpen);
  const print = useUi((s) => s.print);
  const prompt = useUi((s) => s.prompt);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const commentToolsVisible = useUi((s) => s.commentToolsVisible);
  const pageDialog = useUi((s) => s.pageDialog);
  const combine = useUi((s) => s.combine);

  useEffect(() => {
    const offOpened = api.onFileOpened((result) => void handleOpenResult(result));
    const offCommand = api.onMenuCommand((command) => executeCommand(command));
    const refreshRecent = () => void api.recent.list().then((list) => useUi.getState().setRecent(list));
    const offRecent = api.onRecentChanged(refreshRecent);
    const offClose = api.onRequestClose(() => void handleCloseRequest());
    refreshRecent();
    void api.getSettings().then((settings) => useUi.getState().setAuthorName(settings.authorName));
    api.signalReady();
    return () => {
      offOpened();
      offCommand();
      offRecent();
      offClose();
    };
  }, []);

  useMenuStateSync();
  useGlobalKeys();
  useFileDrop();
  useAnnotationSync();

  useEffect(() => {
    document.title = active ? `${active.name} – ${PRODUCT_NAME}` : PRODUCT_NAME;
  }, [active]);

  const propertiesTab = tabs.find((tab) => tab.id === propertiesTabId);
  const showDocumentChrome = tabs.length > 0 && active !== null;

  return (
    <div className={styles.app}>
      <Toolbar />
      {tabs.length > 0 && <TabBar />}
      {commentToolsVisible && active?.status === 'ready' && active.mode === 'view' && <CommentToolbar tab={active} />}
      <div className={styles.workspace}>
        {!showDocumentChrome ? (
          <StartScreen />
        ) : (
          <>
            {sidebarVisible && active.status === 'ready' && active.mode === 'view' && <LeftSidebar tab={active} />}
            <main className={styles.documents}>
              {tabs.map((tab) => (
                <DocumentPane key={tab.id} tab={tab} active={tab.id === activeId} />
              ))}
            </main>
            {rightPanelVisible && active.status === 'ready' && active.mode === 'view' && <RightPanel tab={active} />}
          </>
        )}
      </div>
      {active?.status === 'password' && <PasswordDialog key={active.id} tab={active} />}
      {propertiesTab && <PropertiesDialog tab={propertiesTab} />}
      {goToPageOpen && active?.status === 'ready' && <GoToPageDialog tab={active} />}
      {print && <PrintProgressDialog progress={print} />}
      {settingsOpen && <SettingsDialog />}
      {pageDialog && <PageDialogs key={`${pageDialog.kind}-${pageDialog.tabId}`} dialog={pageDialog} />}
      {combine && <CombineDialog sources={combine} />}
      <SourcePasswordDialog />
      <BusyOverlay />
      {prompt && <PromptDialog key={`${prompt.kind}-${prompt.tabId}`} prompt={prompt} />}
      <Notices />
      <DropOverlay />
    </div>
  );
}
