// Startseite (ADR 0028): Anheften in „Zuletzt geöffnet“, Vorschaubilder, Kennungen und Speicher der eigenen Vorlagen
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_RECENT_FILES, RecentFiles } from '../../src/main/files/recent-files';
import { MAX_THUMBNAILS, ThumbnailStore } from '../../src/main/files/thumbnails';
import { UserTemplates } from '../../src/main/templates/user-templates';
import { parseTemplateId } from '../../src/shared/templates';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-start-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

describe('Anheften', () => {
  it('hält angeheftete Dateien oben und beim erneuten Öffnen an ihrem Platz', async () => {
    const recent = new RecentFiles(path.join(tempDir(), 'recent.json'), 'linux');
    await recent.add('/a.pdf', 1);
    await recent.add('/b.pdf', 2);
    await recent.add('/c.pdf', 3);
    await recent.setPinned('/a.pdf', true);
    expect((await recent.list()).map((f) => [f.path, f.pinned === true])).toEqual([
      ['/a.pdf', true],
      ['/c.pdf', false],
      ['/b.pdf', false],
    ]);
    await recent.add('/b.pdf', 4);
    await recent.add('/a.pdf', 5);
    expect((await recent.list()).map((f) => f.path)).toEqual(['/a.pdf', '/b.pdf', '/c.pdf']);
    expect((await recent.list())[0]?.pinned).toBe(true);
  });

  it('Liste leeren lässt angeheftete stehen; angeheftete fallen nicht aus der Liste', async () => {
    const file = path.join(tempDir(), 'recent.json');
    const recent = new RecentFiles(file, 'linux');
    await recent.add('/fest.pdf', 0);
    await recent.setPinned('/fest.pdf', true);
    for (let n = 0; n < MAX_RECENT_FILES + 5; n++) await recent.add(`/datei-${n}.pdf`, n + 1);
    const list = await recent.list();
    expect(list[0]?.path).toBe('/fest.pdf');
    expect(list.filter((f) => !f.pinned)).toHaveLength(MAX_RECENT_FILES);
    expect(await recent.clear()).toEqual([expect.objectContaining({ path: '/fest.pdf', pinned: true })]);
    // Wieder gelesen (Datei): Anheften bleibt erhalten
    expect(await new RecentFiles(file, 'linux').list()).toEqual([expect.objectContaining({ path: '/fest.pdf', pinned: true })]);
    await recent.setPinned('/fest.pdf', false);
    expect((await recent.list())[0]?.pinned).toBeUndefined();
  });
});

describe('Vorschaubilder', () => {
  it('speichert nur PNG-Bilder und liefert sie als data:-Adresse', async () => {
    const store = new ThumbnailStore(tempDir());
    expect(await store.set('file:/a.pdf', new Uint8Array([1, 2, 3]))).toBe(false);
    expect(await store.set('file:/a.pdf', PNG)).toBe(true);
    expect(await store.get('file:/a.pdf')).toMatch(/^data:image\/png;base64,/);
    expect(await store.get('file:/b.pdf')).toBeNull();
    await store.remove('file:/a.pdf');
    expect(await store.get('file:/a.pdf')).toBeNull();
  });

  it('hält höchstens MAX_THUMBNAILS Bilder', async () => {
    const dir = tempDir();
    const store = new ThumbnailStore(dir);
    for (let n = 0; n < MAX_THUMBNAILS + 3; n++) await store.set(`file:/${n}.pdf`, PNG);
    expect(readdirSync(dir)).toHaveLength(MAX_THUMBNAILS);
  });
});

describe('Vorlagen', () => {
  it('erkennt nur gültige Kennungen', () => {
    expect(parseTemplateId('builtin:letter')).toEqual({ kind: 'builtin', name: 'letter' });
    expect(parseTemplateId('builtin:unbekannt')).toBeNull();
    expect(parseTemplateId('user:Mein Brief.pdf')).toEqual({ kind: 'user', file: 'Mein Brief.pdf' });
    expect(parseTemplateId('user:../geheim.pdf')).toBeNull();
    expect(parseTemplateId('user:ordner/datei.pdf')).toBeNull();
    expect(parseTemplateId('user:.versteckt.pdf')).toBeNull();
    expect(parseTemplateId('user:datei.txt')).toBeNull();
    expect(parseTemplateId(42)).toBeNull();
  });

  it('sichert eigene Vorlagen ohne zu überschreiben und entfernt sie wieder', async () => {
    const templates = new UserTemplates(tempDir());
    const first = await templates.save('Brief: Müller/Schmidt', PDF, 'Vorlage');
    const second = await templates.save('Brief: Müller/Schmidt', PDF, 'Vorlage');
    expect(first).toEqual({ ok: true, template: { id: 'user:Brief- Müller-Schmidt.pdf', name: 'Brief- Müller-Schmidt', builtin: false } });
    expect(second.ok && second.template.name).toBe('Brief- Müller-Schmidt 2');
    expect((await templates.list()).map((t) => t.name).sort()).toEqual(['Brief- Müller-Schmidt', 'Brief- Müller-Schmidt 2']);
    expect(await templates.read('Brief- Müller-Schmidt.pdf')).toEqual(PDF);
    await templates.remove('Brief- Müller-Schmidt.pdf');
    expect(await templates.list()).toHaveLength(1);
    expect((await templates.save('   ', PDF, 'Vorlage')).ok && 'ok').toBe('ok');
    expect((await templates.list()).some((t) => t.name === 'Vorlage')).toBe(true);
  });
});
