// Vorschaubilder für die Startseite (erste Seite zuletzt geöffneter Dateien und der Vorlagen) als kleine PNG-Dateien im
// Profil. Der Renderer zeichnet sie mit pdf.js und schickt sie her; gespeichert wird unter einem Hash des Schlüssels.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Mehr Bilder braucht die Startseite nicht; die ältesten fallen weg
export const MAX_THUMBNAILS = 200;
// Ein Vorschaubild ist etwa 240 px breit; mehr als 512 KB ist keines
export const MAX_THUMBNAIL_BYTES = 512 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export class ThumbnailStore {
  constructor(private readonly folder: string) {}

  private fileOf(key: string): string {
    return path.join(this.folder, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.png`);
  }

  // Bild als data:-Adresse oder null
  async get(key: string): Promise<string | null> {
    try {
      const bytes = await readFile(this.fileOf(key));
      return isPng(bytes) ? `data:image/png;base64,${bytes.toString('base64')}` : null;
    } catch {
      return null;
    }
  }

  async set(key: string, png: Uint8Array): Promise<boolean> {
    if (!isPng(png) || png.length > MAX_THUMBNAIL_BYTES) return false;
    await mkdir(this.folder, { recursive: true });
    await writeFile(this.fileOf(key), png);
    await this.prune();
    return true;
  }

  async remove(key: string): Promise<void> {
    await rm(this.fileOf(key), { force: true });
  }

  private async prune(): Promise<void> {
    const names = (await readdir(this.folder).catch(() => [] as string[])).filter((name) => name.endsWith('.png'));
    if (names.length <= MAX_THUMBNAILS) return;
    const dated = await Promise.all(
      names.map(async (name) => ({ name, time: (await stat(path.join(this.folder, name)).catch(() => null))?.mtimeMs ?? 0 })),
    );
    dated.sort((a, b) => a.time - b.time);
    for (const { name } of dated.slice(0, names.length - MAX_THUMBNAILS)) await rm(path.join(this.folder, name), { force: true });
  }
}
