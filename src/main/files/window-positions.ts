import path from 'node:path';
import type { Rect } from '../window-layout';
import { JsonStore } from './json-store';

// Fensterlage je Dokument (ADR 0026): Ein Dokument öffnet wieder dort, wo sein Fenster zuletzt lag, z. B. zwei
// Dokumente nebeneinander. Gemerkt wird nur bei Fenstern mit genau einem Dokument.
export const MAX_WINDOW_POSITIONS = 100;

interface Entry {
  path: string;
  bounds: Rect;
}

interface WindowPositionsData {
  version: 1;
  entries: Entry[];
}

const isRect = (value: unknown): value is Rect => {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) && (r.width as number) > 0 && (r.height as number) > 0;
};

function validate(raw: unknown): WindowPositionsData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { version?: unknown; entries?: unknown };
  if (data.version !== 1 || !Array.isArray(data.entries)) return null;
  const entries = data.entries.filter(
    (e): e is Entry => typeof e === 'object' && e !== null && typeof (e as Entry).path === 'string' && path.isAbsolute((e as Entry).path) && isRect((e as Entry).bounds),
  );
  return { version: 1, entries: entries.slice(0, MAX_WINDOW_POSITIONS).map((e) => ({ path: e.path, bounds: { x: e.bounds.x, y: e.bounds.y, width: e.bounds.width, height: e.bounds.height } })) };
}

export class WindowPositions {
  #store: JsonStore<WindowPositionsData>;
  #platform: NodeJS.Platform;
  #entries: Entry[] = [];

  constructor(filePath: string, platform: NodeJS.Platform = process.platform) {
    this.#store = new JsonStore(filePath, () => ({ version: 1, entries: [] }), validate);
    this.#platform = platform;
  }

  async load(): Promise<void> {
    this.#entries = (await this.#store.read()).entries;
  }

  // macOS und Windows unterscheiden Groß- und Kleinschreibung in Dateinamen normalerweise nicht
  #same(a: string, b: string): boolean {
    return this.#platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
  }

  get(filePath: string): Rect | null {
    return this.#entries.find((entry) => this.#same(entry.path, filePath))?.bounds ?? null;
  }

  remember(filePath: string, bounds: Rect): Promise<void> {
    const previous = this.get(filePath);
    if (previous && ['x', 'y', 'width', 'height'].every((k) => previous[k as keyof Rect] === bounds[k as keyof Rect])) return Promise.resolve();
    const rest = this.#entries.filter((entry) => !this.#same(entry.path, filePath));
    this.#entries = [{ path: filePath, bounds: { ...bounds } }, ...rest].slice(0, MAX_WINDOW_POSITIONS);
    return this.#store.write({ version: 1, entries: this.#entries });
  }
}
