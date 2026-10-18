// Eigene Vorlagen (ADR 0028): PDFs im Ordner „Vorlagen“ des Profils. „Als Vorlage sichern“ legt eine Kopie des
// aktuellen Stands dort ab; die Startseite zeigt sie neben den mitgelieferten.
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { sanitizeFileName } from '../../shared/validate';
import type { SaveTemplateResult, TemplateInfo } from '../../shared/templates';
import { atomicWrite } from '../files/atomic-write';

export const MAX_USER_TEMPLATES = 100;

const toInfo = (file: string): TemplateInfo => ({ id: `user:${file}`, name: file.replace(/\.pdf$/i, ''), builtin: false });

export class UserTemplates {
  constructor(private readonly folder: string) {}

  async list(): Promise<TemplateInfo[]> {
    const names = await readdir(this.folder).catch(() => [] as string[]);
    const files = names.filter((name) => /\.pdf$/i.test(name) && !name.startsWith('.'));
    const dated = await Promise.all(files.map(async (name) => ({ name, time: (await stat(path.join(this.folder, name)).catch(() => null))?.mtimeMs ?? 0 })));
    // Neueste zuerst
    return dated.sort((a, b) => b.time - a.time).map(({ name }) => toInfo(name));
  }

  async read(file: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(path.join(this.folder, path.basename(file))));
    } catch {
      return null;
    }
  }

  // Gleiche Namen bekommen eine Nummer („Brief 2“), vorhandene Vorlagen werden nie überschrieben
  async save(name: string, bytes: Uint8Array, fallbackName: string): Promise<SaveTemplateResult> {
    const existing = await readdir(this.folder).catch(() => [] as string[]);
    if (existing.filter((file) => /\.pdf$/i.test(file)).length >= MAX_USER_TEMPLATES) return { ok: false, error: 'too-many' };
    const base = sanitizeFileName(name, fallbackName).replace(/\.pdf$/i, '');
    const taken = new Set(existing.map((file) => file.toLowerCase()));
    let file = `${base}.pdf`;
    for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${base} ${n}.pdf`;
    try {
      await mkdir(this.folder, { recursive: true });
      await atomicWrite(path.join(this.folder, file), bytes);
    } catch {
      return { ok: false, error: 'write-failed' };
    }
    return { ok: true, template: toInfo(file) };
  }

  async remove(file: string): Promise<void> {
    await rm(path.join(this.folder, path.basename(file)), { force: true });
  }
}
