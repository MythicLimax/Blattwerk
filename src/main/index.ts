import { app, BrowserWindow, dialog, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandId } from '../shared/commands';
import { IPC, type AppSettings, type MenuState, type OpenResult, type RecentFile } from '../shared/ipc';
import { APP_ID, APP_ORIGIN, PRODUCT_NAME } from '../shared/product';
import { FileRegistry } from './files/file-registry';
import { RecentFiles } from './files/recent-files';
import { SignatureStore } from './files/signatures';
import { setAsDefaultPdfApp } from './default-app';
import { t } from './i18n';
import { registerIpc, showOpenDialog } from './ipc';
import { applyMenu } from './menu';
import { handleAppScheme, registerAppScheme } from './protocol';
import { hardenSession, hardenWebContents, isTrustedAppUrl } from './security';
import { createMainWindow, createSettingsStore, type SettingsData, type WindowState } from './window';

// Testschalter wirken nur beim Entwickeln, nie in der installierten App.
const isE2E = !app.isPackaged && Boolean(process.env.BLATTWERK_E2E);
const devServerUrl = app.isPackaged ? null : (process.env.BLATTWERK_DEV_SERVER_URL ?? null);
const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : null;

app.setName(PRODUCT_NAME);
// Windows: Taskleiste und Sprungliste ordnen das Fenster sonst nicht der installierten Verknüpfung zu.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// Tests laufen mit eigenem Profilordner, damit sie keine echten Einstellungen verändern.
// Der Ordner für Einstellungen lässt sich auch in der installierten App umlenken (Rauchtest
// scripts/smoke-packaged.mjs). Das betrifft nur Einstellungen und die Liste zuletzt geöffneter Dateien.
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
let signatures: SignatureStore;
let mainWindow: BrowserWindow | null = null;
let rendererReady = false;
// Erst nach dem Start (Einstellungen gelesen, IPC registriert) dürfen Fenster entstehen.
// Vorher angeforderte Dateien landen in pendingPaths und öffnen im ersten Fenster.
let initialized = false;
let menuState: MenuState = {
  hasDocument: false,
  canPrint: false,
  viewMode: null,
  sidebarVisible: true,
  rightPanelVisible: false,
  tabCount: 0,
  dirtyCount: 0,
  canUndo: false,
  canRedo: false,
  activeDirty: false,
  commentToolsVisible: false,
  organizeMode: false,
  canAssemble: false,
  canExtract: false,
};
// Schließen mit ungespeicherten Änderungen: Der Renderer fragt nach und bestätigt dann.
let allowClose = false;
let quitting = false;

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

function revealWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.focus();
}

app.on('second-instance', (_event, argv) => {
  for (const p of pathsFromArgv(argv)) requestOpen(p);
  if (mainWindow && rendererReady) revealWindow(mainWindow);
});

// Dateien werden nacheinander geöffnet, damit die Tabs in der angeforderten Reihenfolge entstehen
// und die zuletzt angeforderte Datei vorne liegt.
let openChain: Promise<void> = Promise.resolve();
function enqueueOpen(win: BrowserWindow, filePath: string): void {
  openChain = openChain
    .then(async () => {
      if (win.isDestroyed()) return;
      sendOpenResult(win, await openPathFor(win, filePath));
    })
    .catch(() => undefined);
}

function requestOpen(filePath: string): void {
  if (mainWindow && rendererReady) {
    enqueueOpen(mainWindow, filePath);
    // Sonst öffnet sich die Datei unsichtbar in einem minimierten Fenster.
    revealWindow(mainWindow);
  } else {
    pendingPaths.push(filePath);
    if (initialized && !mainWindow) void createWindow();
  }
}

function sendOpenResult(win: BrowserWindow | null, result: OpenResult): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.fileOpened, result);
}

async function openPathFor(win: BrowserWindow, filePath: string): Promise<OpenResult> {
  const result = await files.open(filePath, win.webContents.id);
  if (result.ok) {
    try {
      await recent.add(filePath);
    } catch (error) {
      // Die Liste zuletzt geöffneter Dateien ist Nebensache und darf das Öffnen nicht verhindern.
      console.error('Zuletzt-Liste konnte nicht gespeichert werden', error);
    }
    if (process.platform === 'darwin' || process.platform === 'win32') app.addRecentDocument(filePath);
    refreshMenu();
    if (!win.isDestroyed()) win.webContents.send(IPC.recentChanged);
  }
  return result;
}

function sendCommand(command: CommandId): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (win && !win.isDestroyed()) win.webContents.send(IPC.menuCommand, { command });
}

// Leert die eigene Liste und die des Systems (Dock unter macOS, Sprungliste unter Windows).
async function clearRecentEverywhere(): Promise<RecentFile[]> {
  const list = await recent.clear();
  if (process.platform === 'darwin' || process.platform === 'win32') app.clearRecentDocuments();
  refreshMenu();
  mainWindow?.webContents.send(IPC.recentChanged);
  return list;
}

async function openFileDialogFromMenu(): Promise<void> {
  if (!initialized) return;
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
      clearRecent: () => void clearRecentEverywhere(),
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
let settings: SettingsData = { version: 1, window: windowState, authorName: null };

function saveSettings(patch: Partial<SettingsData>): void {
  settings = { ...settings, ...patch };
  void settingsStore.write(settings);
}

// Vorgabe für den Autor von Kommentaren: vollständiger Name (macOS) oder Benutzername.
let systemAuthor: string | null = null;
function defaultAuthor(): string {
  if (systemAuthor) return systemAuthor;
  let name = '';
  if (process.platform === 'darwin') {
    try {
      name = execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim();
    } catch {
      name = '';
    }
  }
  systemAuthor = name || os.userInfo().username;
  return systemAuthor;
}

function currentSettings(): AppSettings {
  return { authorName: settings.authorName ?? defaultAuthor() };
}

async function createWindow(): Promise<BrowserWindow> {
  rendererReady = false;
  const win = createMainWindow({
    preloadPath,
    state: windowState,
    devTools: !app.isPackaged || isE2E,
    onStateChange: (state) => {
      windowState = state;
      saveSettings({ window: state });
    },
  });
  mainWindow = win;
  allowClose = false;
  win.on('close', (event) => {
    if (allowClose || menuState.dirtyCount === 0 || !rendererReady) return;
    event.preventDefault();
    win.webContents.send(IPC.requestClose);
  });
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
  // Absturz der Oberfläche (z. B. zu wenig Speicher): Dateien freigeben und Neuladen anbieten.
  // Bis zum Neuladen angeforderte Dateien warten in pendingPaths und öffnen danach.
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || mainWindow !== win) return;
    rendererReady = false;
    void files.closeAllOwnedBy(ownerId);
    menuState = { ...menuState, hasDocument: false, canPrint: false, tabCount: 0, viewMode: null };
    refreshMenu();
    void dialog
      .showMessageBox(win, {
        type: 'error',
        message: t('dialog.rendererGone.message'),
        detail: t('dialog.rendererGone.detail'),
        buttons: [t('dialog.rendererGone.reload'), t('dialog.rendererGone.close')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) win.webContents.reload();
        else win.close();
      });
  });
  await win.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
  return win;
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, devServerOrigin));

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (initialized && !mainWindow) void createWindow();
});

void app.whenReady().then(async () => {
  hardenSession(devServerOrigin);
  handleAppScheme(rendererDir);
  recent = new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json'));
  signatures = new SignatureStore(path.join(app.getPath('userData'), 'signatures.json'));
  settings = await settingsStore.read();
  windowState = settings.window;
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({ applicationName: PRODUCT_NAME, applicationVersion: app.getVersion() });
  }

  registerIpc({
    files,
    recent,
    signatures,
    appVersion: app.getVersion(),
    isTrustedSender,
    onMenuState: (win, state) => {
      if (win !== mainWindow) return;
      menuState = state;
      if (process.platform === 'darwin') win.setDocumentEdited(state.dirtyCount > 0);
      refreshMenu();
    },
    onRendererReady: (win) => {
      if (win !== mainWindow) return;
      rendererReady = true;
      for (const p of pendingPaths.splice(0)) enqueueOpen(win, p);
    },
    onRecentChanged: () => refreshMenu(),
    clearRecent: clearRecentEverywhere,
    openPathFor,
    onSavedAs: async (filePath) => {
      try {
        await recent.add(filePath);
      } catch (error) {
        console.error('Zuletzt-Liste konnte nicht gespeichert werden', error);
      }
      if (process.platform === 'darwin' || process.platform === 'win32') app.addRecentDocument(filePath);
      refreshMenu();
      mainWindow?.webContents.send(IPC.recentChanged);
    },
    getSettings: currentSettings,
    setAuthorName: async (name) => {
      saveSettings({ authorName: name });
      return currentSettings();
    },
    onCloseConfirmed: (win) => {
      if (win !== mainWindow) return;
      allowClose = true;
      win.close();
      // Unter macOS beendet das Schließen des letzten Fensters die App nicht von selbst.
      if (quitting) app.quit();
    },
    onCloseCancelled: () => {
      quitting = false;
    },
  });

  refreshMenu();
  initialized = true;
  if (!mainWindow) await createWindow();
});
