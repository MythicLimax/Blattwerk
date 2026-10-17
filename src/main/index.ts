import { app, BrowserWindow, dialog, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandId } from '../shared/commands';
import {
  IPC,
  type AppSettings,
  type FileInfo,
  type MenuState,
  type OpenResult,
  type RecentFile,
  type TabDestination,
  type TabReceived,
  type TabTransfer,
  type TabTransferResult,
} from '../shared/ipc';
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
import { boundsAtPoint, cascadeFrom, dropTarget } from './window-layout';
import { isBlankDocumentPath, removeBlankDocuments } from './files/blank-document';
import { defaultUpdateFolder, runPendingInstall, setCustomUpdateFolder } from './update/updater';
import { attachNativeGlass, describeNativeGlass, nativeGlassAvailable } from './native-glass';

// Testschalter wirken nur beim Entwickeln, nie in der installierten App.
const isE2E = !app.isPackaged && Boolean(process.env.BLATTWERK_E2E);
// Tests unsichtbar: kein Fenster, kein Dock-Symbol, kein Wegnehmen des Fokus. Wirkt auch in der fertigen App
// (Rauchtest), weil es nur die Anzeige unterdrückt und nichts an der Sicherheit ändert.
const runHidden = (isE2E && !process.env.BLATTWERK_E2E_SHOW) || process.env.BLATTWERK_HIDDEN === '1';
// So früh wie möglich, damit das Symbol gar nicht erst im Dock erscheint
if (runHidden) app.dock?.hide();
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

const EMPTY_MENU_STATE: MenuState = {
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
  formEditing: false,
  canEditForms: false,
  redactToolsVisible: false,
  hasRedactionMarks: false,
  contentEditing: false,
  markToolsVisible: false,
};

// Was ein Fenster beim Start öffnen soll: eine Datei oder ein Tab aus einem anderen Fenster
type PendingOpen = { kind: 'path'; path: string; recent?: boolean } | { kind: 'tab'; file: FileInfo; transfer: TabTransfer };

// Jedes Dokument hat sein eigenes Fenster (ADR 0026). Je Fenster: Zustand für Menü und Schließen.
interface WindowContext {
  win: BrowserWindow;
  // webContents-ID; unter ihr gehören die geöffneten Dateien diesem Fenster
  ownerId: number;
  ready: boolean;
  menuState: MenuState;
  // Schließen mit ungespeicherten Änderungen: Der Renderer fragt nach und bestätigt dann.
  allowClose: boolean;
  // Vor dem Start des Renderers angeforderte Dateien und übergebene Tabs
  pending: PendingOpen[];
}

const windows = new Map<BrowserWindow, WindowContext>();
// Fenster in der Reihenfolge, in der sie zuletzt vorn waren (das vordere zuerst). Menü und Befehle folgen dem vorderen.
let zOrder: WindowContext[] = [];
// Ziel von „Alle Fenster zusammenführen“
let mergeTarget: WindowContext | null = null;
// Eigentümer von Dateien, die gerade von einem Fenster ins nächste wandern
const IN_TRANSIT = -1;
// Eigentümer beim Prüfen einer Datei, bevor dafür ein Fenster entsteht
const PROBE = -2;

// Erst nach dem Start (Einstellungen gelesen, IPC registriert) dürfen Fenster entstehen.
// Vorher angeforderte Dateien landen in startupPaths.
let initialized = false;
let quitting = false;
const startupPaths: string[] = [];

const contextOf = (win: BrowserWindow | null): WindowContext | null => (win ? (windows.get(win) ?? null) : null);
const contextByOwner = (ownerId: number): WindowContext | null => [...windows.values()].find((ctx) => ctx.ownerId === ownerId) ?? null;
const frontContext = (): WindowContext | null => zOrder.find((ctx) => !ctx.win.isDestroyed()) ?? null;

function bringToFront(ctx: WindowContext): void {
  if (zOrder[0] === ctx) return;
  zOrder = [ctx, ...zOrder.filter((other) => other !== ctx)];
  refreshMenu();
}

// Holt ein Fenster nach vorn. Unsichtbare Testläufe ändern nur die Reihenfolge, nie den Fokus.
function showWindow(ctx: WindowContext): void {
  bringToFront(ctx);
  if (runHidden || ctx.win.isDestroyed()) return;
  if (ctx.win.isMinimized()) ctx.win.restore();
  ctx.win.focus();
}

// Leer heißt: Startseite, kein Dokument und keines unterwegs. Ein leeres Fenster nimmt das nächste Dokument auf.
const isEmpty = (ctx: WindowContext): boolean =>
  ctx.pending.length === 0 && ctx.menuState.tabCount === 0 && !files.hasDocuments(ctx.ownerId);

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

startupPaths.push(...pathsFromArgv(process.argv));

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  requestOpen(filePath);
});

app.on('second-instance', (_event, argv) => {
  const paths = pathsFromArgv(argv);
  for (const p of paths) requestOpen(p);
  const front = frontContext();
  if (paths.length === 0 && front) showWindow(front);
});

// Dateien werden nacheinander geöffnet, damit die Fenster in der angeforderten Reihenfolge entstehen.
let openChain: Promise<void> = Promise.resolve();
function chain(task: () => Promise<void>): void {
  openChain = openChain.then(task).catch((error: unknown) => console.error('Öffnen fehlgeschlagen', error));
}

// Öffnen ohne anfragendes Fenster (Finder, Kommandozeile, Menü). Fehler zeigt das vordere Fenster.
function requestOpen(filePath: string): void {
  if (!initialized) {
    startupPaths.push(filePath);
    return;
  }
  chain(async () => {
    const result = await openDocument(null, filePath);
    if (!result.ok && result.error !== 'elsewhere') sendOpenResult(frontContext()?.win ?? null, result);
  });
}

function sendOpenResult(win: BrowserWindow | null, result: OpenResult): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.fileOpened, result);
}

function broadcast(channel: string): void {
  for (const ctx of windows.values()) if (!ctx.win.isDestroyed()) ctx.win.webContents.send(channel);
}

async function rememberRecent(filePath: string): Promise<void> {
  try {
    await recent.add(filePath);
  } catch (error) {
    // Die Liste zuletzt geöffneter Dateien ist Nebensache und darf das Öffnen nicht verhindern.
    console.error('Zuletzt-Liste konnte nicht gespeichert werden', error);
  }
  if (process.platform === 'darwin' || process.platform === 'win32') app.addRecentDocument(filePath);
  refreshMenu();
  broadcast(IPC.recentChanged);
}

// Öffnet eine Datei als Tab in genau diesem Fenster. Unbenannte Dokumente (temporärer Ordner) kommen nicht in
// „Zuletzt geöffnet“ und tragen die Kennzeichnung untitled.
async function openPathFor(win: BrowserWindow, filePath: string, options: { recent?: boolean } = {}): Promise<OpenResult> {
  const untitled = isBlankDocumentPath(filePath);
  const result = await files.open(filePath, win.webContents.id);
  if (!result.ok) return result;
  if (!untitled && options.recent !== false) await rememberRecent(filePath);
  return untitled ? { ...result, file: { ...result.file, untitled: true } } : result;
}

// Öffnet ein Dokument (ADR 0026): im anfragenden Fenster, wenn es leer ist (Startseite); ist die Datei schon in einem
// anderen Fenster offen, kommt dieses nach vorn; sonst entsteht ein neues Fenster. Ohne anfragendes Fenster gilt das
// vordere. 'elsewhere' heißt für den Renderer: nichts zu tun.
async function openDocument(requester: BrowserWindow | null, filePath: string, options: { recent?: boolean } = {}): Promise<OpenResult> {
  const from = contextOf(requester);
  const elsewhere: OpenResult = { ok: false, error: 'elsewhere' };
  const ownerId = files.documentOwner(filePath);
  const owner = ownerId === null ? null : contextByOwner(ownerId);
  if (owner && owner !== from) {
    showWindow(owner);
    return elsewhere;
  }
  const target = from ?? frontContext();
  if (target && (owner === target || isEmpty(target))) {
    if (!target.ready) {
      // Das Fenster startet gerade (z. B. beim Start der App): Es öffnet die Datei, sobald es bereit ist.
      target.pending.push({ kind: 'path', path: filePath, recent: options.recent });
      return elsewhere;
    }
    const result = await openPathFor(target.win, filePath, options);
    if (from) return result;
    sendOpenResult(target.win, result);
    showWindow(target);
    return elsewhere;
  }
  // Vorher prüfen, ob sich die Datei öffnen lässt: Fehler erscheinen im anfragenden Fenster statt in einem leeren neuen.
  const probe = await files.open(filePath, PROBE);
  if (!probe.ok) return probe;
  await files.close(probe.file.fileId, PROBE);
  createWindow({ pending: [{ kind: 'path', path: filePath, recent: options.recent }], near: target });
  return elsewhere;
}

// Liefert, was ein Fenster beim Start bzw. bei der Übergabe eines Tabs öffnen soll.
async function deliver(ctx: WindowContext, item: PendingOpen): Promise<void> {
  if (ctx.win.isDestroyed()) return;
  if (item.kind === 'path') {
    sendOpenResult(ctx.win, await openPathFor(ctx.win, item.path, { recent: item.recent }));
    return;
  }
  if (!files.transfer(item.file.fileId, IN_TRANSIT, ctx.ownerId)) return;
  const message: TabReceived = { file: item.file, transfer: item.transfer };
  ctx.win.webContents.send(IPC.tabReceived, message);
}

// Tab in ein anderes Fenster geben (herausgezogen oder „Alle Fenster zusammenführen“). Die Datei bleibt dabei offen und
// wechselt nur den Eigentümer; der Stand beim Öffnen bleibt, damit Änderungen von außen erkannt werden.
async function transferTab(win: BrowserWindow, fileId: string, transfer: TabTransfer, destination: TabDestination): Promise<TabTransferResult> {
  const source = contextOf(win);
  const info = source ? files.infoOf(fileId, source.ownerId) : null;
  const filePath = source ? files.pathOf(fileId, source.ownerId) : null;
  if (!source || !info || !filePath) return { ok: false, error: 'unknown-file' };
  const file: FileInfo = isBlankDocumentPath(filePath) ? { ...info, untitled: true } : info;

  let target: WindowContext | null = null;
  let newBounds: Rectangle | null = null;
  if (destination.kind === 'merge') {
    target = mergeTarget && mergeTarget !== source && windows.has(mergeTarget.win) ? mergeTarget : null;
    if (!target) return { ok: false, error: 'nothing-to-do' };
  } else if (destination.kind === 'new') {
    // Menü „Tab in neues Fenster bewegen“: versetzt zum bisherigen Fenster
    if (source.menuState.tabCount <= 1) return { ok: false, error: 'nothing-to-do' };
  } else {
    const point = { x: destination.x, y: destination.y };
    const others = zOrder
      .filter((ctx) => ctx !== source && !ctx.win.isDestroyed() && !ctx.win.isMinimized())
      .map((ctx) => ({ id: ctx, bounds: ctx.win.getBounds() }));
    const drop = dropTarget(point, { id: source, bounds: source.win.getBounds() }, others);
    if (drop.kind === 'window') {
      target = drop.id;
    } else {
      // Der einzige Tab eines Fensters wird nicht zu einem neuen Fenster: Das wäre dasselbe noch einmal.
      if (source.menuState.tabCount <= 1) return { ok: false, error: 'nothing-to-do' };
      const size = source.win.getNormalBounds();
      newBounds = boundsAtPoint(size, point, screen.getDisplayNearestPoint(point).workArea);
    }
  }

  if (!files.transfer(fileId, source.ownerId, IN_TRANSIT)) return { ok: false, error: 'unknown-file' };
  const item: PendingOpen = { kind: 'tab', file, transfer };
  if (!target) {
    createWindow({ pending: [item], bounds: newBounds ?? undefined, near: source });
    return { ok: true };
  }
  if (target.ready) await deliver(target, item);
  else target.pending.push(item);
  if (destination.kind === 'point') showWindow(target);
  return { ok: true };
}

// „Fenster → Alle Fenster zusammenführen“: Jedes andere Fenster gibt seine Tabs an das vordere ab und schließt sich.
function mergeAllWindows(): void {
  const target = frontContext();
  if (!target) return;
  mergeTarget = target;
  for (const ctx of windows.values()) {
    if (ctx !== target && ctx.ready && !ctx.win.isDestroyed()) ctx.win.webContents.send(IPC.mergeRequest);
  }
}

function sendCommand(command: CommandId): void {
  const ctx = contextOf(BrowserWindow.getFocusedWindow()) ?? frontContext();
  if (ctx && !ctx.win.isDestroyed()) ctx.win.webContents.send(IPC.menuCommand, { command });
}

// Leert die eigene Liste und die des Systems (Dock unter macOS, Sprungliste unter Windows).
async function clearRecentEverywhere(): Promise<RecentFile[]> {
  const list = await recent.clear();
  if (process.platform === 'darwin' || process.platform === 'win32') app.clearRecentDocuments();
  refreshMenu();
  broadcast(IPC.recentChanged);
  return list;
}

async function openFileDialogFromMenu(): Promise<void> {
  if (!initialized) return;
  const paths = await showOpenDialog(frontContext()?.win ?? null);
  for (const p of paths) requestOpen(p);
}

// Eigener Update-Ordner (ADR 0025): z. B. ein Ordner in iCloud Drive oder OneDrive, den mehrere Rechner sehen
async function chooseUpdateFolderFromMenu(): Promise<void> {
  const win = frontContext()?.win;
  const options = {
    title: t('dialog.updateFolderTitle'),
    message: t('dialog.updateFolderMessage'),
    buttonLabel: t('dialog.chooseFolderButton'),
    defaultPath: settings.updateFolder ?? defaultUpdateFolder(),
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return;
  saveSettings({ updateFolder: folder === defaultUpdateFolder() ? null : folder });
  sendCommand('app.checkUpdates');
}

// Das Menü zeigt den Zustand des vorderen Fensters.
function refreshMenu(): void {
  if (!recent) return;
  void recent.list().then((list) =>
    applyMenu({
      platform: process.platform,
      state: frontContext()?.menuState ?? EMPTY_MENU_STATE,
      windowCount: windows.size,
      recent: list,
      devTools: !app.isPackaged || isE2E,
      sendCommand,
      openFileDialog: () => void openFileDialogFromMenu(),
      openRecent: (p) => requestOpen(p),
      clearRecent: () => void clearRecentEverywhere(),
      setDefaultApp: () => void setAsDefaultPdfApp(frontContext()?.win ?? null),
      chooseUpdateFolder: () => void chooseUpdateFolderFromMenu(),
      mergeWindows: mergeAllWindows,
    }),
  );
}

function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  const own = [...windows.keys()].some((win) => !win.isDestroyed() && event.sender === win.webContents);
  return own && isTrustedAppUrl(frame.url, devServerOrigin);
}

const settingsStore = createSettingsStore(app.getPath('userData'));
let windowState: WindowState = { bounds: null, maximized: false };
let settings: SettingsData = { version: 1, window: windowState, authorName: null, lastIdPath: null, updateFolder: null };

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

// Neuladen oder Absturz der Oberfläche: Dateien des Fensters freigeben, Menüzustand zurücksetzen
function releaseWindow(ctx: WindowContext): void {
  void files.closeAllOwnedBy(ctx.ownerId);
  ctx.ready = false;
  ctx.menuState = EMPTY_MENU_STATE;
}

interface NewWindowOptions {
  pending?: PendingOpen[];
  // Lage des neuen Fensters (herausgezogener Tab)
  bounds?: Rectangle;
  // Fenster, zu dem das neue versetzt erscheint (sonst das vordere)
  near?: WindowContext | null;
}

function createWindow(options: NewWindowOptions = {}): WindowContext {
  const near = options.near ?? frontContext();
  // Weitere Fenster erscheinen leicht versetzt zum vorderen; das erste an der gespeicherten Stelle.
  const bounds =
    options.bounds ??
    (near && !near.win.isDestroyed() ? cascadeFrom(near.win.getNormalBounds(), screen.getDisplayMatching(near.win.getNormalBounds()).workArea) : undefined);
  const win = createMainWindow({
    preloadPath,
    state: windowState,
    bounds,
    devTools: !app.isPackaged || isE2E,
    hidden: runHidden,
    transparent: nativeGlassAvailable(),
    onStateChange: (state) => {
      windowState = state;
      saveSettings({ window: state });
    },
  });
  const ctx: WindowContext = {
    win,
    ownerId: win.webContents.id,
    ready: false,
    menuState: EMPTY_MENU_STATE,
    allowClose: false,
    pending: [...(options.pending ?? [])],
  };
  windows.set(win, ctx);
  zOrder = [ctx, ...zOrder];
  // macOS 26+: Apples Liquid Glass unter den durchsichtigen Bereichen des Fensters (ADR 0023)
  attachNativeGlass(win);
  win.on('focus', () => bringToFront(ctx));
  win.on('close', (event) => {
    if (ctx.allowClose || ctx.menuState.dirtyCount === 0 || !ctx.ready) return;
    event.preventDefault();
    win.webContents.send(IPC.requestClose);
  });
  win.on('closed', () => {
    void files.closeAllOwnedBy(ctx.ownerId);
    // Tabs, die noch auf dem Weg in dieses Fenster waren
    for (const item of ctx.pending) if (item.kind === 'tab') void files.close(item.file.fileId, IN_TRANSIT);
    ctx.pending = [];
    windows.delete(win);
    zOrder = zOrder.filter((other) => other !== ctx);
    if (mergeTarget === ctx) mergeTarget = null;
    refreshMenu();
  });
  // Beim Neuladen des Renderers (z. B. in der Entwicklung) Dateien freigeben.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) releaseWindow(ctx);
  });
  // Absturz der Oberfläche (z. B. zu wenig Speicher): Dateien freigeben und Neuladen anbieten.
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    releaseWindow(ctx);
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
  void win.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`).catch((error: unknown) => console.error('Fenster konnte nicht laden', error));
  refreshMenu();
  return ctx;
}

app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, devServerOrigin));

app.on('will-quit', () => {
  removeBlankDocuments();
  // Vorgemerktes Update: Hilfsskript tauscht die App nach dem Beenden aus (ADR 0025)
  runPendingInstall();
});

app.on('before-quit', () => {
  quitting = true;
});

// Das letzte Fenster zu schließen beendet die App auf allen Systemen, auch unter macOS (Wunsch des Auftraggebers).
// Die Rückfrage bei ungespeicherten Änderungen kommt vorher beim Schließen jedes Fensters.
app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (initialized && windows.size === 0) createWindow();
});

void app.whenReady().then(async () => {
  // Oberflächentests laufen unsichtbar: kein Fenster, kein Symbol im Dock, kein Wegnehmen des Fokus
  hardenSession(devServerOrigin);
  handleAppScheme(rendererDir);
  recent = new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json'));
  signatures = new SignatureStore(path.join(app.getPath('userData'), 'signatures.json'));
  settings = await settingsStore.read();
  setCustomUpdateFolder(() => settings.updateFolder);
  windowState = settings.window;
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({ applicationName: PRODUCT_NAME, applicationVersion: app.getVersion() });
  }
  // Oberflächentests lesen die nativen Glasflächen des vorderen Fensters aus
  if (isE2E) {
    (globalThis as { __blattwerkGlass?: () => unknown }).__blattwerkGlass = () => {
      const front = frontContext();
      return front ? describeNativeGlass(front.win) : [];
    };
  }

  registerIpc({
    files,
    recent,
    signatures,
    appVersion: app.getVersion(),
    isTrustedSender,
    onMenuState: (win, state) => {
      const ctx = contextOf(win);
      if (!ctx) return;
      ctx.menuState = state;
      if (process.platform === 'darwin') win.setDocumentEdited(state.dirtyCount > 0);
      refreshMenu();
    },
    onRendererReady: (win) => {
      const ctx = contextOf(win);
      if (!ctx) return;
      ctx.ready = true;
      const items = ctx.pending;
      ctx.pending = [];
      chain(async () => {
        for (const item of items) await deliver(ctx, item);
      });
    },
    onRecentChanged: () => refreshMenu(),
    clearRecent: clearRecentEverywhere,
    openDocument,
    onSavedAs: rememberRecent,
    getSettings: currentSettings,
    setAuthorName: async (name) => {
      saveSettings({ authorName: name });
      return currentSettings();
    },
    getLastIdPath: () => settings.lastIdPath,
    setLastIdPath: (filePath) => saveSettings({ lastIdPath: filePath }),
    onCloseConfirmed: (win) => {
      const ctx = contextOf(win);
      if (!ctx) return;
      ctx.allowClose = true;
      win.close();
      // Beenden: Electron hat das Beenden beim ersten Fenster mit Rückfrage angehalten; jetzt geht es weiter
      // (und fragt beim nächsten Fenster mit ungespeicherten Änderungen).
      if (quitting) app.quit();
    },
    onCloseCancelled: () => {
      quitting = false;
    },
    onCloseWindow: (win) => {
      const ctx = contextOf(win);
      // Nur Fenster ohne Dokumente (der letzte Tab ist in ein anderes Fenster gewandert)
      if (!ctx || files.hasDocuments(ctx.ownerId)) return;
      ctx.allowClose = true;
      win.close();
    },
    transferTab,
    quit: () => app.quit(),
  });

  initialized = true;
  createWindow();
  // Beim Start übergebene Dateien: die erste im ersten Fenster, jede weitere in einem eigenen
  for (const p of startupPaths.splice(0)) requestOpen(p);
});
