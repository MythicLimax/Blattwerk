import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC, type AppInfo, type MenuState, type OpenResult, type PrintRequest } from '../shared/ipc';
import { PRODUCT_NAME } from '../shared/product';
import { isFileId, validateMenuState } from '../shared/validate';
import { setAsDefaultPdfApp } from './default-app';
import type { FileRegistry } from './files/file-registry';
import type { RecentFiles } from './files/recent-files';
import { t } from './i18n';
import { printWindow } from './print';
import { confirmAndOpenExternal } from './security';

export interface IpcContext {
  files: FileRegistry;
  recent: RecentFiles;
  appVersion: string;
  isTrustedSender: (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => boolean;
  onMenuState: (win: BrowserWindow, state: MenuState) => void;
  onRendererReady: (win: BrowserWindow) => void;
  onRecentChanged: () => void;
  openPathFor: (win: BrowserWindow, filePath: string) => Promise<OpenResult>;
}

export async function showOpenDialog(win: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: t('dialog.openTitle'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: t('dialog.filterPdf'), extensions: ['pdf'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

export function registerIpc(ctx: IpcContext): void {
  const windowOf = (event: IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(event.sender);

  // Jeder Handler prüft zuerst, ob die Nachricht aus unserem eigenen Fenster kommt.
  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R,
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!ctx.isTrustedSender(event)) throw new Error('untrusted-sender');
      return fn(event, ...(args as A));
    });
  };

  handle(IPC.openDialog, async (event): Promise<OpenResult[]> => {
    const win = windowOf(event);
    if (!win) return [];
    const paths = await showOpenDialog(win);
    return Promise.all(paths.map((p) => ctx.openPathFor(win, p)));
  });

  handle(IPC.openDropped, async (event, filePath: unknown): Promise<OpenResult> => {
    const win = windowOf(event);
    if (!win || typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096) {
      return { ok: false, error: 'unreadable' };
    }
    return ctx.openPathFor(win, filePath);
  });

  handle(IPC.readRange, (event, fileId: unknown, begin: unknown, end: unknown) => {
    if (!isFileId(fileId)) throw new Error('invalid-file-id');
    return ctx.files.read(fileId, begin, end, event.sender.id);
  });

  handle(IPC.closeFile, async (event, fileId: unknown) => {
    if (isFileId(fileId)) await ctx.files.close(fileId, event.sender.id);
  });

  handle(IPC.recentList, () => ctx.recent.list());

  handle(IPC.recentOpen, async (event, filePath: unknown): Promise<OpenResult> => {
    const win = windowOf(event);
    // Nur Pfade, die wirklich in der Liste stehen, dürfen so geöffnet werden.
    if (!win || typeof filePath !== 'string' || !(await ctx.recent.contains(filePath))) {
      return { ok: false, error: 'not-found' };
    }
    return ctx.openPathFor(win, filePath);
  });

  handle(IPC.recentRemove, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string') return ctx.recent.list();
    const list = await ctx.recent.remove(filePath);
    ctx.onRecentChanged();
    return list;
  });

  handle(IPC.recentClear, async () => {
    const list = await ctx.recent.clear();
    ctx.onRecentChanged();
    return list;
  });

  handle(IPC.appInfo, (): AppInfo => ({
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    version: ctx.appVersion,
    productName: PRODUCT_NAME,
    e2e: Boolean(process.env.BLATTWERK_E2E),
  }));

  handle(IPC.print, async (event, request: unknown) => {
    const win = windowOf(event);
    if (!win) return { ok: false, reason: 'failed' } as const;
    const name =
      typeof request === 'object' && request !== null && typeof (request as PrintRequest).documentName === 'string'
        ? (request as PrintRequest).documentName
        : PRODUCT_NAME;
    return printWindow(win, { documentName: name });
  });

  handle(IPC.openExternal, (event, url: unknown) => {
    if (typeof url !== 'string') return false;
    return confirmAndOpenExternal(url, windowOf(event));
  });

  handle(IPC.defaultApp, (event) => setAsDefaultPdfApp(windowOf(event)));

  ipcMain.on(IPC.menuState, (event, state: unknown) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    const valid = validateMenuState(state);
    if (win && valid) ctx.onMenuState(win, valid);
  });

  ipcMain.on(IPC.rendererReady, (event) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    if (win) ctx.onRendererReady(win);
  });
}
