import { BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import path from 'node:path';
import { PRODUCT_NAME } from '../shared/product';
import { JsonStore } from './files/json-store';

export interface WindowState {
  bounds: Rectangle | null;
  maximized: boolean;
}

interface SettingsData {
  version: 1;
  window: WindowState;
}

function isRect(value: unknown): value is Rectangle {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
}

function validateSettings(raw: unknown): SettingsData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { version?: unknown; window?: { bounds?: unknown; maximized?: unknown } };
  if (data.version !== 1 || typeof data.window !== 'object' || data.window === null) return null;
  return {
    version: 1,
    window: {
      bounds: isRect(data.window.bounds) ? data.window.bounds : null,
      maximized: data.window.maximized === true,
    },
  };
}

export function createSettingsStore(userDataDir: string): JsonStore<SettingsData> {
  return new JsonStore(
    path.join(userDataDir, 'settings.json'),
    () => ({ version: 1, window: { bounds: null, maximized: false } }),
    validateSettings,
  );
}

// Gespeicherte Fensterposition nur übernehmen, wenn sie noch auf einem vorhandenen Bildschirm liegt.
function visibleBounds(bounds: Rectangle | null): Rectangle | null {
  if (!bounds) return null;
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    return overlapX > 100 && overlapY > 100;
  });
  return visible ? bounds : null;
}

export interface CreateWindowOptions {
  preloadPath: string;
  state: WindowState;
  devTools: boolean;
  onStateChange: (state: WindowState) => void;
}

export function createMainWindow(options: CreateWindowOptions): BrowserWindow {
  const bounds = visibleBounds(options.state.bounds);
  const win = new BrowserWindow({
    ...(bounds ?? { width: 1280, height: 860 }),
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#f3f3f3',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: options.devTools,
    },
  });

  if (options.state.maximized) win.maximize();
  // Pinch-Zoom des Browsers aus: Zoomen übernimmt der Viewer selbst.
  void win.webContents.setVisualZoomLevelLimits(1, 1);
  win.once('ready-to-show', () => win.show());

  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      options.onStateChange({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    }, 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    options.onStateChange({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  });

  return win;
}
