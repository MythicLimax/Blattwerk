import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileInfo, OpenResult } from '../../shared/ipc';
import { looksLikePdf, validateReadRange } from '../../shared/validate';

interface OpenFile {
  info: FileInfo;
  path: string;
  handle: fs.FileHandle;
  ownerId: number;
  // Stand beim Öffnen. Ändert sich die Datei danach, liefern Lesezugriffe einen Fehler statt falscher Daten.
  mtimeMs: number;
}

export class FileChangedError extends Error {
  constructor() {
    super('file-changed');
    this.name = 'FileChangedError';
  }
}

// Verwaltet geöffnete Dateien. Der Renderer kennt nur Datei-IDs, nie die Handles.
// Jede Datei gehört zu genau einem Renderer (webContents-ID); nur dieser darf daraus lesen.
export class FileRegistry {
  #files = new Map<string, OpenFile>();

  async open(filePath: string, ownerId: number): Promise<OpenResult> {
    const name = path.basename(filePath);
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { ok: false, error: code === 'ENOENT' ? 'not-found' : 'unreadable', name };
    }
    if (!stat.isFile()) return { ok: false, error: 'not-a-file', name };

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(filePath, 'r');
    } catch {
      return { ok: false, error: 'unreadable', name };
    }

    try {
      const head = new Uint8Array(1024);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      if (!looksLikePdf(head.subarray(0, bytesRead))) {
        await handle.close();
        return { ok: false, error: 'not-pdf', name };
      }
    } catch {
      await handle.close().catch(() => undefined);
      return { ok: false, error: 'unreadable', name };
    }

    // Größe und Zeitstempel über das geöffnete Handle, nicht über den Pfad: kein Zeitfenster dazwischen.
    let opened;
    try {
      opened = await handle.stat();
    } catch {
      await handle.close().catch(() => undefined);
      return { ok: false, error: 'unreadable', name };
    }
    const info: FileInfo = { fileId: randomUUID(), name, dir: path.dirname(filePath), size: opened.size };
    this.#files.set(info.fileId, { info, path: filePath, handle, ownerId, mtimeMs: opened.mtimeMs });
    return { ok: true, file: info };
  }

  async read(fileId: string, begin: unknown, end: unknown, ownerId: number): Promise<Uint8Array> {
    const file = this.#files.get(fileId);
    if (!file || file.ownerId !== ownerId) throw new Error('unknown-file');
    const range = validateReadRange(begin, end, file.info.size);
    if (!range) throw new Error('invalid-range');
    const current = await file.handle.stat();
    if (current.size !== file.info.size || current.mtimeMs !== file.mtimeMs) throw new FileChangedError();
    const length = range.end - range.begin;
    const buffer = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await file.handle.read(buffer, offset, length - offset, range.begin + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    // Weniger Bytes als erwartet heißt: Die Datei wurde gekürzt. Nie still unvollständige Daten liefern.
    if (offset !== length) throw new FileChangedError();
    return buffer;
  }

  // true, wenn die Datei auf der Platte noch dem Stand beim Öffnen entspricht (Größe und Änderungszeit).
  // Wird vor dem Überschreiben geprüft, damit fremde Änderungen nicht verloren gehen.
  async isUnchangedOnDisk(fileId: string, ownerId: number): Promise<boolean> {
    const file = this.#files.get(fileId);
    if (!file || file.ownerId !== ownerId) return false;
    try {
      const current = await fs.stat(file.path);
      return current.size === file.info.size && current.mtimeMs === file.mtimeMs;
    } catch {
      return false;
    }
  }

  // Nach dem Speichern: alte Datei-ID schließen, die gespeicherte Datei neu öffnen.
  async reopen(fileId: string, ownerId: number, newPath?: string): Promise<OpenResult> {
    const file = this.#files.get(fileId);
    if (!file || file.ownerId !== ownerId) return { ok: false, error: 'not-found' };
    await this.close(fileId, ownerId);
    return this.open(newPath ?? file.path, ownerId);
  }

  pathOf(fileId: string, ownerId: number): string | null {
    const file = this.#files.get(fileId);
    return file && file.ownerId === ownerId ? file.path : null;
  }

  async close(fileId: string, ownerId: number): Promise<void> {
    const file = this.#files.get(fileId);
    if (!file || file.ownerId !== ownerId) return;
    this.#files.delete(fileId);
    await file.handle.close().catch(() => undefined);
  }

  async closeAllOwnedBy(ownerId: number): Promise<void> {
    const ids = [...this.#files.values()].filter((f) => f.ownerId === ownerId).map((f) => f.info.fileId);
    await Promise.all(ids.map((id) => this.close(id, ownerId)));
  }

  get openCount(): number {
    return this.#files.size;
  }
}
