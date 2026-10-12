import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CommandId } from '../shared/commands';
import { IPC, type MenuState, type OpenResult } from '../shared/ipc';
import { APP_ORIGIN, PRODUCT_NAME } from '../shared/product';
import { FileRegistry } from './files/file-registry';
import { RecentFiles } from './files/recent-files';
import { setAsDefaultPdfApp } from './default-app';
import { registerIpc, showOpenDialog } from './ipc';
import { applyMenu } from './menu';
import { handleAppScheme, registerAppScheme } from './protocol';
import { hardenSession, hardenWebContents, isTrustedAppUrl } from './security';
import { createMainWindow, createSettingsStore, type WindowState } from './window';

const isE2E = Boolean(process.env.BLATTWERK_E2E);
const devServerUrl = app.isPackaged ? null : (process.env.BLATTWERK_DEV_SERVER_URL ?? null);
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : null;

app.setName(PRODUCT_NAME);
// Tests laufen mit eigenem Profilordner, damit sie keine echten Einstellungen verändern.
if (process.env.BLATTWERK_USER_DATA) {
  app.setPath('userData', process.env.BLATTWERK_USER_DATA);
}

registerAppScheme();

// Eine laufende Instanz reicht. Weitere Starts reichen ihre Dateien an die erste weiter.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const moduleDir = import.meta.dirname;
const rendererDir = path.join(moduleDir, '..', 'renderer');
const preloadPath = path.join(moduleDir, '..', 'preload', 'index.cjs');

const files = new FileRegistry();
let recent: RecentFiles;
let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
let menuState: MenuState = {
  hasDocument: false,
  canPrint: false,
  viewMode: null,
  sidebarVisible: true,
  rightPanelVisible: false,
  tabCount: 0,
};

// Dateien, die vor dem Start des Renderers angefordert wurden (Doppelklick im Finder, Kommandozeile).
const pendingPaths: string[] = [];

function pathsFromArgv(argv: string[]): string[] {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((arg) => {
    if (arg.startsWith('-')) return false;
    try {
      return path.isAbsolute(arg) && existsSync(arg) && statSync(arg).isFile();
    } catch {
      return false;
    }
  });
}

pendingPaths.push(...pathsFromArgv(process.argv));

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  requestOpen(filePath);
});

app.on('second-instance', (_event, argv) => {
  for (const p of pathsFromArgv(argv)) requestOpen(p);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function requestOpen(filePath: string): void {
  if (mainWindow && rendererReady) {
    void openPathFor(mainWindow, filePath).then((result) => sendOpenResult(mainWindow, result));
  } else {
    pendingPaths.push(filePath);
    if (app.isReady() && !mainWindow) void createWindow();
  }
}

function sendOpenResult(win: BrowserWindow | null, result: OpenResult): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.fileOpened, result);
}

async function openPathFor(win: BrowserWindow, filePath: string): Promise<OpenResult> {
  const result = await files.open(filePath, win.webContents.id);
  if (result.ok) {
    await recent.add(filePath);
    if (process.platform === 'darwin' || process.platform === 'win32') app.addRecentDocument(filePath);
    refreshMenu();
    win.webContents.send(IPC.recentChanged);
  }
  return result;
}

function sendCommand(command: CommandId): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send(IPC.menuCommand, { command });
}

async function openFileDialogFromMenu(): Promise<void> {
  const win = mainWindow ?? (await createWindow());
  const paths = await showOpenDialog(win);
  for (const p of paths) requestOpen(p);
}

function refreshMenu(): void {
  void recent.list().then((list) =>
    applyMenu({
      platform: process.platform,
      state: menuState,
      recent: list,
      devTools: !app.isPackaged || isE2E,
      sendCommand,
      openFileDialog: () => void openFileDialogFromMenu(),
      openRecent: (p) => requestOpen(p),
      clearRecent: () => {
        void recent.clear().then(() => {
          app.clearRecentDocuments();
          refreshMenu();
          mainWindow?.webContents.send(IPC.recentChanged);
        });
      },
      setDefaultApp: () => void setAsDefaultPdfApp(mainWindow),
    }),
  );
}

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || event.sender !== mainWindow.webContents) return false;
  return isTrustedAppUrl(frame.url, devServerOrigin);
}

const settingsStore = createSettingsStore(app.getPath('userData'));
let windowState: WindowState = { bounds: null, maximized: false };

async function createWindow(): Promise<BrowserWindow> {
  rendererReady = false;
  const win = createMainWindow({
    preloadPath,
    state: windowState,
    devTools: !app.isPackaged || isE2E,
    onStateChange: (state) => {
      windowState = state;
      void settingsStore.write({ version: 1, window: state });
    },
  });
  mainWindow = win;
  const ownerId = win.webContents.id;
  win.on('closed', () => {
    void files.closeAllOwnedBy(ownerId);
    if (mainWindow === win) {
      mainWindow = null;
      rendererReady = false;
      menuState = { ...menuState, hasDocument: false, canPrint: false, tabCount: 0, viewMode: null };
      refreshMenu();
    }
  });
  // Beim Neuladen des Renderers (z. B. in der Entwicklung) Dateien freigeben.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      rendererReady = false;
      void files.closeAllOwnedBy(ownerId);
    }
  });
  await win.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
  return win;
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, devServerOrigin));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow && app.isReady()) void createWindow();
});

void app.whenReady().then(async () => {
  hardenSession();
  handleAppScheme(rendererDir);
  recent = new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json'));
  windowState = (await settingsStore.read()).window;
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({ applicationName: PRODUCT_NAME, applicationVersion: app.getVersion() });
  }

  registerIpc({
    files,
    recent,
    appVersion: app.getVersion(),
    isTrustedSender,
    onMenuState: (win, state) => {
      if (win !== mainWindow) return;
      menuState = state;
      refreshMenu();
    },
    onRendererReady: (win) => {
      if (win !== mainWindow) return;
      rendererReady = true;
      const paths = pendingPaths.splice(0);
      for (const p of paths) {
        void openPathFor(win, p).then((result) => sendOpenResult(win, result));
      }
    },
    onRecentChanged: () => refreshMenu(),
    openPathFor,
  });

  refreshMenu();
  await createWindow();
});
