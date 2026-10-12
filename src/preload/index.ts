import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { isCommandId } from '../shared/commands';
import { IPC, type MenuCommandMessage, type OpenResult } from '../shared/ipc';
import type { BlattwerkApi } from './api-types';

// Kleine, feste Schnittstelle. Der Renderer bekommt nie direkten Zugriff auf ipcRenderer.
function subscribe<T>(channel: string, map: (payload: unknown) => T | null, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    const value = map(payload);
    if (value !== null) listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: BlattwerkApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openFileDialog: () => ipcRenderer.invoke(IPC.openDialog),
  openDroppedFile: (file: File) => {
    let filePath: string;
    try {
      filePath = webUtils.getPathForFile(file);
    } catch {
      filePath = '';
    }
    return ipcRenderer.invoke(IPC.openDropped, filePath);
  },
  readRange: (fileId, begin, end) => ipcRenderer.invoke(IPC.readRange, fileId, begin, end),
  closeFile: (fileId) => ipcRenderer.invoke(IPC.closeFile, fileId),
  recent: {
    list: () => ipcRenderer.invoke(IPC.recentList),
    open: (path) => ipcRenderer.invoke(IPC.recentOpen, path),
    remove: (path) => ipcRenderer.invoke(IPC.recentRemove, path),
    clear: () => ipcRenderer.invoke(IPC.recentClear),
  },
  print: (request) => ipcRenderer.invoke(IPC.print, request),
  saveFile: (fileId, bytes, force) => ipcRenderer.invoke(IPC.saveFile, fileId, bytes, force === true),
  saveFileAs: (fileId, bytes) => ipcRenderer.invoke(IPC.saveFileAs, fileId, bytes),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setAuthorName: (name) => ipcRenderer.invoke(IPC.settingsSetAuthor, name),
  confirmClose: () => ipcRenderer.send(IPC.closeConfirmed),
  cancelClose: () => ipcRenderer.send(IPC.closeCancelled),
  onRequestClose: (listener) => subscribe(IPC.requestClose, () => true, () => listener()),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  setMenuState: (state) => ipcRenderer.send(IPC.menuState, state),
  signalReady: () => ipcRenderer.send(IPC.rendererReady),
  onFileOpened: (listener) =>
    subscribe(IPC.fileOpened, (p) => (typeof p === 'object' && p !== null ? (p as OpenResult) : null), listener),
  onMenuCommand: (listener) =>
    subscribe(
      IPC.menuCommand,
      (p) => {
        const command = (p as MenuCommandMessage | null)?.command;
        return isCommandId(command) ? command : null;
      },
      listener,
    ),
  onRecentChanged: (listener) => subscribe(IPC.recentChanged, () => true, () => listener()),
};

contextBridge.exposeInMainWorld('blattwerk', api);
