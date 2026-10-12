import path from 'node:path';
import type { RecentFile } from '../../shared/ipc';
import { JsonStore } from './json-store';

export const MAX_RECENT_FILES = 15;

interface RecentFilesData {
  version: 1;
  files: RecentFile[];
}

function validate(raw: unknown): RecentFilesData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { version?: unknown; files?: unknown };
  if (data.version !== 1 || !Array.isArray(data.files)) return null;
  const files = data.files.filter(
    (f): f is RecentFile =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as RecentFile).path === 'string' &&
      path.isAbsolute((f as RecentFile).path) &&
      typeof (f as RecentFile).openedAt === 'number',
  );
  return {
    version: 1,
    files: files.slice(0, MAX_RECENT_FILES).map((f) => ({
      path: f.path,
      name: path.basename(f.path),
      dir: path.dirname(f.path),
      openedAt: f.openedAt,
    })),
  };
}

// Pfade werden unter Windows ohne Beachtung der Groß-/Kleinschreibung verglichen.
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export class RecentFiles {
  #store: JsonStore<RecentFilesData>;
  #platform: NodeJS.Platform;
  #cache: RecentFilesData | null = null;

  constructor(filePath: string, platform: NodeJS.Platform = process.platform) {
    this.#store = new JsonStore(filePath, () => ({ version: 1, files: [] }), validate);
    this.#platform = platform;
  }

  async list(): Promise<RecentFile[]> {
    this.#cache ??= await this.#store.read();
    return [...this.#cache.files];
  }

  async contains(filePath: string): Promise<boolean> {
    const files = await this.list();
    return files.some((f) => samePath(f.path, filePath, this.#platform));
  }

  async add(filePath: string, now: number = Date.now()): Promise<RecentFile[]> {
    const files = (await this.list()).filter((f) => !samePath(f.path, filePath, this.#platform));
    files.unshift({ path: filePath, name: path.basename(filePath), dir: path.dirname(filePath), openedAt: now });
    return this.#save(files.slice(0, MAX_RECENT_FILES));
  }

  async remove(filePath: string): Promise<RecentFile[]> {
    const files = (await this.list()).filter((f) => !samePath(f.path, filePath, this.#platform));
    return this.#save(files);
  }

  async clear(): Promise<RecentFile[]> {
    return this.#save([]);
  }

  async #save(files: RecentFile[]): Promise<RecentFile[]> {
    this.#cache = { version: 1, files };
    await this.#store.write(this.#cache);
    return [...files];
  }
}
