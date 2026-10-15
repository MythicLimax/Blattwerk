import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  IPC,
  type AppInfo,
  type AppSettings,
  type ExportFolderResult,
  type ExportTextResult,
  type ExportWriteResult,
  type MenuState,
  type OpenResult,
  type PickKind,
  type PickResult,
  type PrintRequest,
  type RecentFile,
  type SaveNewResult,
  type SaveResult,
  type SaveToFolderResult,
} from '../shared/ipc';
import { PRODUCT_NAME } from '../shared/product';
import {
  isExportText,
  isFileId,
  isImageBytes,
  isPdfBytes,
  isPickKind,
  isSignatureInput,
  isSafeLocalPath,
  sanitizeFileName,
  validateAuthorName,
  validateMenuState,
  validateNamedPdfs,
} from '../shared/validate';
import { atomicWrite } from './files/atomic-write';
import type { FileRegistry } from './files/file-registry';
import type { RecentFiles } from './files/recent-files';
import type { SignatureStore } from './files/signatures';
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
  clearRecent: () => Promise<RecentFile[]>;
  openPathFor: (win: BrowserWindow, filePath: string) => Promise<OpenResult>;
  // Nach erfolgreichem Speichern unter neuem Namen (Zuletzt-Liste, Menü)
  onSavedAs: (filePath: string) => Promise<void>;
  getSettings: () => AppSettings;
  setAuthorName: (name: string) => Promise<AppSettings>;
  onCloseConfirmed: (win: BrowserWindow) => void;
  onCloseCancelled: (win: BrowserWindow) => void;
  signatures: SignatureStore;
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

function pickFilters(kind: PickKind): Electron.FileFilter[] {
  const pdf = { name: t('dialog.filterPdf'), extensions: ['pdf'] };
  const images = { name: t('dialog.filterImages'), extensions: ['jpg', 'jpeg', 'png'] };
  if (kind === 'pdf') return [pdf];
  if (kind === 'images') return [images];
  return [{ name: t('dialog.filterPdfImages'), extensions: ['pdf', 'jpg', 'jpeg', 'png'] }, pdf, images];
}

const withPdfExtension = (filePath: string) => (path.extname(filePath).toLowerCase() === '.pdf' ? filePath : `${filePath}.pdf`);

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Freier Dateiname im Ordner: „Name.pdf“, sonst „Name (2).pdf“, „Name (3).pdf“ …
async function uniquePath(dir: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - extension.length);
  for (let n = 1; n < 10000; n++) {
    const candidate = path.join(dir, n === 1 ? fileName : `${base} (${n})${extension}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('no-free-name');
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
    const results: OpenResult[] = [];
    for (const p of paths) results.push(await ctx.openPathFor(win, p));
    return results;
  });

  handle(IPC.openDropped, async (event, filePath: unknown): Promise<OpenResult> => {
    const win = windowOf(event);
    if (!win || !isSafeLocalPath(filePath, process.platform)) {
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

  handle(IPC.recentClear, () => ctx.clearRecent());

  handle(IPC.appInfo, (): AppInfo => ({
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    version: ctx.appVersion,
    productName: PRODUCT_NAME,
    e2e: !app.isPackaged && Boolean(process.env.BLATTWERK_E2E),
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

  // Speichern über die vorhandene Datei. Vorher prüfen, ob die Datei inzwischen von außen geändert wurde.
  handle(IPC.saveFile, async (event, fileId: unknown, bytes: unknown, force: unknown): Promise<SaveResult> => {
    if (!isFileId(fileId)) return { ok: false, error: 'unknown-file' };
    if (!isPdfBytes(bytes)) return { ok: false, error: 'invalid-data' };
    const owner = event.sender.id;
    const target = ctx.files.pathOf(fileId, owner);
    if (!target) return { ok: false, error: 'unknown-file' };
    if (force !== true && !(await ctx.files.isUnchangedOnDisk(fileId, owner))) {
      return { ok: false, error: 'changed-externally' };
    }
    try {
      await atomicWrite(target, bytes);
    } catch (error) {
      return { ok: false, error: 'write-failed', detail: String(error) };
    }
    const reopened = await ctx.files.reopen(fileId, owner);
    return reopened.ok ? { ok: true, file: reopened.file } : { ok: false, error: 'write-failed', detail: reopened.error };
  });

  handle(IPC.saveFileAs, async (event, fileId: unknown, bytes: unknown): Promise<SaveResult> => {
    const win = windowOf(event);
    if (!win || !isFileId(fileId)) return { ok: false, error: 'unknown-file' };
    if (!isPdfBytes(bytes)) return { ok: false, error: 'invalid-data' };
    const owner = event.sender.id;
    const current = ctx.files.pathOf(fileId, owner);
    if (!current) return { ok: false, error: 'unknown-file' };
    const result = await dialog.showSaveDialog(win, {
      title: t('dialog.saveAsTitle'),
      defaultPath: current,
      filters: [{ name: t('dialog.filterPdf'), extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
    const target = path.extname(result.filePath).toLowerCase() === '.pdf' ? result.filePath : `${result.filePath}.pdf`;
    try {
      await atomicWrite(target, bytes);
    } catch (error) {
      return { ok: false, error: 'write-failed', detail: String(error) };
    }
    const reopened = await ctx.files.reopen(fileId, owner, target);
    if (!reopened.ok) return { ok: false, error: 'write-failed', detail: reopened.error };
    await ctx.onSavedAs(target);
    return { ok: true, file: reopened.file };
  });

  // Quelldateien zum Einfügen oder Zusammenführen wählen (PDFs und/oder JPEG/PNG). Öffnet keinen Tab.
  handle(IPC.pickFiles, async (event, kind: unknown): Promise<PickResult> => {
    const win = windowOf(event);
    if (!win || !isPickKind(kind)) return { files: [], rejected: [] };
    const result = await dialog.showOpenDialog(win, {
      title: t(`dialog.pickTitle.${kind}`),
      properties: ['openFile', 'multiSelections'],
      filters: pickFilters(kind),
    });
    const picked: PickResult = { files: [], rejected: [] };
    if (result.canceled) return picked;
    for (const filePath of result.filePaths) {
      const opened = await ctx.files.open(filePath, event.sender.id, kind);
      if (opened.ok) picked.files.push(opened.file);
      else picked.rejected.push(path.basename(filePath));
    }
    return picked;
  });

  // Per Drag & Drop abgelegte Quelldatei anmelden (Pfad kommt aus dem Preload, nur absolut und lokal)
  handle(IPC.registerDropped, async (event, filePath: unknown): Promise<OpenResult> => {
    if (!isSafeLocalPath(filePath, process.platform)) return { ok: false, error: 'unreadable' };
    return ctx.files.open(filePath, event.sender.id, 'pdf-or-images');
  });

  // Neues Dokument speichern (Zusammenführen, Extrahieren, Bilder → PDF). Den Ort wählt der Nutzer im Dialog.
  handle(
    IPC.saveNewFile,
    async (event, bytes: unknown, suggestedName: unknown, referenceFileId: unknown, openAfter: unknown): Promise<SaveNewResult> => {
      const win = windowOf(event);
      if (!win) return { ok: false, error: 'cancelled' };
      if (!isPdfBytes(bytes)) return { ok: false, error: 'invalid-data' };
      const reference = isFileId(referenceFileId) ? ctx.files.pathOf(referenceFileId, event.sender.id) : null;
      const dir = reference ? path.dirname(reference) : app.getPath('documents');
      const result = await dialog.showSaveDialog(win, {
        title: t('dialog.saveNewTitle'),
        defaultPath: path.join(dir, sanitizeFileName(suggestedName)),
        filters: [{ name: t('dialog.filterPdf'), extensions: ['pdf'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
      const target = withPdfExtension(result.filePath);
      if (ctx.files.isOpenPath(target)) return { ok: false, error: 'target-open' };
      try {
        await atomicWrite(target, bytes);
      } catch (error) {
        return { ok: false, error: 'write-failed', detail: String(error) };
      }
      const open = openAfter === true ? await ctx.openPathFor(win, target) : null;
      return { ok: true, name: path.basename(target), open };
    },
  );

  // Mehrere neue Dokumente in einen gewählten Ordner (Teilen, Extrahieren als einzelne Dateien).
  // Vorhandene Dateien werden nie überschrieben; bei gleichem Namen kommt eine Nummer dazu.
  handle(IPC.saveToFolder, async (event, files: unknown, referenceFileId: unknown): Promise<SaveToFolderResult> => {
    const win = windowOf(event);
    const valid = validateNamedPdfs(files);
    if (!win) return { ok: false, error: 'cancelled' };
    if (!valid) return { ok: false, error: 'invalid-data' };
    const reference = isFileId(referenceFileId) ? ctx.files.pathOf(referenceFileId, event.sender.id) : null;
    const result = await dialog.showOpenDialog(win, {
      title: t('dialog.chooseFolderTitle'),
      buttonLabel: t('dialog.chooseFolderButton'),
      defaultPath: reference ? path.dirname(reference) : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return { ok: false, error: 'cancelled' };
    const names: string[] = [];
    try {
      for (const file of valid) {
        const target = await uniquePath(folder, sanitizeFileName(file.name));
        await atomicWrite(target, file.bytes);
        names.push(path.basename(target));
      }
    } catch (error) {
      return { ok: false, error: 'write-failed', detail: `${names.length}/${valid.length}: ${String(error)}` };
    }
    return { ok: true, folder: path.basename(folder), names };
  });

  // Export als Bilder (Phase 6): Ordner einmal wählen, dann Seite für Seite schreiben. Der Renderer kennt nur ein
  // Kennzeichen für den Ordner; geschrieben wird nur dorthin, mit sicherem Namen, nie über vorhandene Dateien.
  const exportFolders = new Map<string, { dir: string; senderId: number }>();

  handle(IPC.exportChooseFolder, async (event, referenceFileId: unknown): Promise<ExportFolderResult> => {
    const win = windowOf(event);
    if (!win) return { ok: false, error: 'cancelled' };
    const reference = isFileId(referenceFileId) ? ctx.files.pathOf(referenceFileId, event.sender.id) : null;
    const result = await dialog.showOpenDialog(win, {
      title: t('dialog.exportFolderTitle'),
      buttonLabel: t('dialog.chooseFolderButton'),
      defaultPath: reference ? path.dirname(reference) : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = result.filePaths[0];
    if (result.canceled || !folder) return { ok: false, error: 'cancelled' };
    const token = randomUUID();
    exportFolders.set(token, { dir: folder, senderId: event.sender.id });
    return { ok: true, token, folder: path.basename(folder) };
  });

  handle(IPC.exportWriteImage, async (event, token: unknown, name: unknown, kind: unknown, bytes: unknown): Promise<ExportWriteResult> => {
    const folder = typeof token === 'string' ? exportFolders.get(token) : undefined;
    if (!folder || folder.senderId !== event.sender.id) return { ok: false, error: 'unknown-folder' };
    if (!isImageBytes(bytes, kind) || typeof name !== 'string' || name.length > 1000) return { ok: false, error: 'invalid-data' };
    try {
      const target = await uniquePath(folder.dir, sanitizeFileName(name, 'Seite', kind === 'png' ? '.png' : '.jpg'));
      await atomicWrite(target, bytes);
      return { ok: true, name: path.basename(target) };
    } catch (error) {
      return { ok: false, error: 'write-failed', detail: String(error) };
    }
  });

  handle(IPC.exportEnd, (_event, token: unknown) => {
    if (typeof token === 'string') exportFolders.delete(token);
  });

  // Export als Text: Sichern-Dialog, UTF-8
  handle(IPC.exportSaveText, async (event, text: unknown, suggestedName: unknown, referenceFileId: unknown): Promise<ExportTextResult> => {
    const win = windowOf(event);
    if (!win) return { ok: false, error: 'cancelled' };
    if (!isExportText(text)) return { ok: false, error: 'invalid-data' };
    const reference = isFileId(referenceFileId) ? ctx.files.pathOf(referenceFileId, event.sender.id) : null;
    const dir = reference ? path.dirname(reference) : app.getPath('documents');
    const result = await dialog.showSaveDialog(win, {
      title: t('dialog.exportTextTitle'),
      defaultPath: path.join(dir, sanitizeFileName(suggestedName, 'Dokument', '.txt')),
      filters: [{ name: t('dialog.filterText'), extensions: ['txt'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' };
    const target = path.extname(result.filePath).toLowerCase() === '.txt' ? result.filePath : `${result.filePath}.txt`;
    if (ctx.files.isOpenPath(target)) return { ok: false, error: 'target-open' };
    try {
      await atomicWrite(target, new TextEncoder().encode(text));
    } catch (error) {
      return { ok: false, error: 'write-failed', detail: String(error) };
    }
    return { ok: true, name: path.basename(target) };
  });

  handle(IPC.signaturesList, () => ctx.signatures.list());
  handle(IPC.signaturesAdd, async (_event, input: unknown) => {
    if (!isSignatureInput(input)) throw new Error('invalid-signature');
    return ctx.signatures.add(input);
  });
  handle(IPC.signaturesRemove, async (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length > 64) return ctx.signatures.list();
    return ctx.signatures.remove(id);
  });

  handle(IPC.settingsGet, () => ctx.getSettings());

  handle(IPC.settingsSetAuthor, async (_event, name: unknown) => {
    const valid = validateAuthorName(name);
    return valid ? ctx.setAuthorName(valid) : ctx.getSettings();
  });

  handle(IPC.openExternal, (event, url: unknown) => {
    if (typeof url !== 'string') return false;
    return confirmAndOpenExternal(url, windowOf(event));
  });

  ipcMain.on(IPC.menuState, (event, state: unknown) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    const valid = validateMenuState(state);
    if (win && valid) ctx.onMenuState(win, valid);
  });

  ipcMain.on(IPC.closeConfirmed, (event) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    if (win) ctx.onCloseConfirmed(win);
  });

  ipcMain.on(IPC.closeCancelled, (event) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    if (win) ctx.onCloseCancelled(win);
  });

  ipcMain.on(IPC.rendererReady, (event) => {
    if (!ctx.isTrustedSender(event)) return;
    const win = windowOf(event);
    if (win) ctx.onRendererReady(win);
  });
}
