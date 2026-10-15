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

// Pfad einer abgelegten Datei; der Renderer sieht ihn nie.
function pathOf(file: File): string {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return '';
  }
}

const api: BlattwerkApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  openFileDialog: () => ipcRenderer.invoke(IPC.openDialog),
  openDroppedFile: (file: File) => ipcRenderer.invoke(IPC.openDropped, pathOf(file)),
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
  pickFiles: (kind) => ipcRenderer.invoke(IPC.pickFiles, kind),
  registerDroppedFile: (file: File) => ipcRenderer.invoke(IPC.registerDropped, pathOf(file)),
  newBlankDocument: () => ipcRenderer.invoke(IPC.newBlank),
  fonts: {
    list: () => ipcRenderer.invoke(IPC.fontsList),
    read: (key) => ipcRenderer.invoke(IPC.fontsRead, key),
  },
  saveNewFile: (bytes, name, referenceFileId, openAfter) =>
    ipcRenderer.invoke(IPC.saveNewFile, bytes, name, referenceFileId, openAfter === true),
  saveFilesToFolder: (files, referenceFileId) => ipcRenderer.invoke(IPC.saveToFolder, files, referenceFileId),
  exportImages: {
    chooseFolder: (referenceFileId) => ipcRenderer.invoke(IPC.exportChooseFolder, referenceFileId),
    write: (token, name, kind, bytes) => ipcRenderer.invoke(IPC.exportWriteImage, token, name, kind, bytes),
    end: (token) => ipcRenderer.invoke(IPC.exportEnd, token),
  },
  exportText: (text, suggestedName, referenceFileId) => ipcRenderer.invoke(IPC.exportSaveText, text, suggestedName, referenceFileId),
  convertDocument: {
    pick: () => ipcRenderer.invoke(IPC.convertPick),
    dropped: (file: File) => ipcRenderer.invoke(IPC.convertDropped, pathOf(file)),
  },
  digitalId: {
    pick: () => ipcRenderer.invoke(IPC.signingPickId),
    last: () => ipcRenderer.invoke(IPC.signingLastId),
    save: (bytes, suggestedName) => ipcRenderer.invoke(IPC.signingSaveId, bytes, suggestedName),
  },
  signatures: {
    list: () => ipcRenderer.invoke(IPC.signaturesList),
    add: (input) => ipcRenderer.invoke(IPC.signaturesAdd, input),
    remove: (id) => ipcRenderer.invoke(IPC.signaturesRemove, id),
  },
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  setAuthorName: (name) => ipcRenderer.invoke(IPC.settingsSetAuthor, name),
  confirmClose: () => ipcRenderer.send(IPC.closeConfirmed),
  cancelClose: () => ipcRenderer.send(IPC.closeCancelled),
  onRequestClose: (listener) => subscribe(IPC.requestClose, () => true, () => listener()),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  setMenuState: (state) => ipcRenderer.send(IPC.menuState, state),
  setGlassRegions: (regions) => ipcRenderer.send(IPC.glassRegions, regions),
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
