import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWrite } from '../../src/main/files/atomic-write';
import { FileRegistry } from '../../src/main/files/file-registry';
import { MAX_RECENT_FILES, RecentFiles } from '../../src/main/files/recent-files';
import { fixture } from '../fixtures/expectations';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'blattwerk-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('atomicWrite', () => {
  it('schreibt eine neue Datei und hinterlässt keine temporären Dateien', async () => {
    const target = path.join(dir, 'a.json');
    await atomicWrite(target, '{"x":1}');
    expect(await readFile(target, 'utf8')).toBe('{"x":1}');
    expect(await readdir(dir)).toEqual(['a.json']);
  });

  it('ersetzt eine vorhandene Datei vollständig und behält die Dateirechte', async () => {
    const target = path.join(dir, 'b.txt');
    await writeFile(target, 'alter, längerer Inhalt');
    await chmod(target, 0o600);
    await atomicWrite(target, 'neu');
    expect(await readFile(target, 'utf8')).toBe('neu');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it('lässt das Ziel unverändert, wenn das Ersetzen scheitert', async () => {
    // Ein Ordner als Ziel: rename schlägt fehl, der Ordner bleibt, die temporäre Datei wird entfernt.
    const target = path.join(dir, 'ordner');
    await mkdir(target);
    await writeFile(path.join(target, 'inhalt.txt'), 'bleibt');
    await expect(atomicWrite(target, 'überschreiben')).rejects.toThrow();
    expect(await readFile(path.join(target, 'inhalt.txt'), 'utf8')).toBe('bleibt');
    expect((await readdir(dir)).sort()).toEqual(['ordner']);
  });
});

describe('RecentFiles', () => {
  const file = (name: string) => path.join(dir, name);

  it('speichert neue Einträge vorne und ohne Doppelungen', async () => {
    const recent = new RecentFiles(file('recent.json'));
    await recent.add('/a/eins.pdf', 1);
    await recent.add('/a/zwei.pdf', 2);
    await recent.add('/a/eins.pdf', 3);
    const list = await recent.list();
    expect(list.map((f) => f.path)).toEqual(['/a/eins.pdf', '/a/zwei.pdf']);
    expect(list[0]).toMatchObject({ name: 'eins.pdf', dir: '/a', openedAt: 3 });
  });

  it('begrenzt die Liste', async () => {
    const recent = new RecentFiles(file('recent.json'));
    for (let i = 0; i < MAX_RECENT_FILES + 5; i++) await recent.add(`/a/${i}.pdf`, i);
    expect(await recent.list()).toHaveLength(MAX_RECENT_FILES);
  });

  it('bleibt nach Neustart erhalten und überlebt kaputte Dateien', async () => {
    await new RecentFiles(file('recent.json')).add('/a/eins.pdf', 1);
    expect((await new RecentFiles(file('recent.json')).list()).map((f) => f.path)).toEqual(['/a/eins.pdf']);
    await writeFile(file('kaputt.json'), '{nicht json');
    expect(await new RecentFiles(file('kaputt.json')).list()).toEqual([]);
  });

  it('entfernt Einträge und leert die Liste', async () => {
    const recent = new RecentFiles(file('recent.json'));
    await recent.add('/a/eins.pdf', 1);
    await recent.add('/a/zwei.pdf', 2);
    expect(await recent.remove('/a/eins.pdf')).toHaveLength(1);
    expect(await recent.contains('/a/zwei.pdf')).toBe(true);
    expect(await recent.clear()).toEqual([]);
  });

  it('vergleicht Pfade unter Windows ohne Groß-/Kleinschreibung', async () => {
    const recent = new RecentFiles(file('recent.json'), 'win32');
    await recent.add('/A/Datei.pdf', 1);
    expect(await recent.contains('/a/datei.PDF')).toBe(true);
  });
});

describe('FileRegistry', () => {
  it('öffnet PDFs und liefert Bytebereiche nur an den Besitzer', async () => {
    const registry = new FileRegistry();
    const result = await registry.open(fixture('text.pdf'), 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const head = await registry.read(result.file.fileId, 0, 5, 1);
    expect(new TextDecoder().decode(head)).toBe('%PDF-');
    await expect(registry.read(result.file.fileId, 0, 5, 2)).rejects.toThrow('unknown-file');
    await expect(registry.read(result.file.fileId, 10, 5, 1)).rejects.toThrow('invalid-range');
    const tail = await registry.read(result.file.fileId, result.file.size - 10, result.file.size + 100, 1);
    expect(tail.length).toBe(10);
    await registry.close(result.file.fileId, 1);
    expect(registry.openCount).toBe(0);
  });

  it('meldet von außen geänderte oder gekürzte Dateien statt falsche Daten zu liefern', async () => {
    const target = path.join(dir, 'aenderbar.pdf');
    await writeFile(target, await readFile(fixture('text.pdf')));
    const registry = new FileRegistry();
    const result = await registry.open(target, 1);
    if (!result.ok) throw new Error('öffnen fehlgeschlagen');
    await expect(registry.read(result.file.fileId, 0, 100, 1)).resolves.toHaveLength(100);
    // An Ort und Stelle kürzen (wie ein anderes Programm, das die Datei neu schreibt)
    await writeFile(target, '%PDF-1.7 gekuerzt');
    await expect(registry.read(result.file.fileId, 0, 100, 1)).rejects.toThrow('file-changed');
    await registry.close(result.file.fileId, 1);
  });

  it('meldet fehlende Dateien, Ordner und Nicht-PDFs', async () => {
    const registry = new FileRegistry();
    expect(await registry.open(path.join(dir, 'fehlt.pdf'), 1)).toMatchObject({ ok: false, error: 'not-found' });
    expect(await registry.open(dir, 1)).toMatchObject({ ok: false, error: 'not-a-file' });
    expect(await registry.open(fixture('kein-pdf.pdf'), 1)).toMatchObject({ ok: false, error: 'not-pdf' });
    expect(registry.openCount).toBe(0);
  });

  it('schließt alle Dateien eines Fensters', async () => {
    const registry = new FileRegistry();
    await registry.open(fixture('text.pdf'), 7);
    await registry.open(fixture('formular.pdf'), 7);
    await registry.open(fixture('scan.pdf'), 8);
    await registry.closeAllOwnedBy(7);
    expect(registry.openCount).toBe(1);
  });

  it('kennt das Fenster eines Dokuments; Quelldateien zählen nicht als Dokument', async () => {
    const registry = new FileRegistry();
    await registry.open(fixture('text.pdf'), 7);
    // Quelldatei zum Einfügen oder Vergleichen
    await registry.open(fixture('formular.pdf'), 8, 'pdf');
    expect(registry.documentOwner(fixture('text.pdf'))).toBe(7);
    expect(registry.documentOwner(fixture('formular.pdf'))).toBeNull();
    expect(registry.hasDocuments(7)).toBe(true);
    expect(registry.hasDocuments(8)).toBe(false);
  });

  it('gibt eine Datei an ein anderes Fenster weiter, ohne sie neu zu öffnen', async () => {
    const registry = new FileRegistry();
    const result = await registry.open(fixture('text.pdf'), 7);
    if (!result.ok) throw new Error('öffnen fehlgeschlagen');
    const { fileId } = result.file;
    expect(registry.transfer(fileId, 8, 9)).toBe(false);
    expect(registry.transfer(fileId, 7, 9)).toBe(true);
    // Das alte Fenster hat keinen Zugriff mehr; sein Schließen ist wirkungslos
    await expect(registry.read(fileId, 0, 5, 7)).rejects.toThrow('unknown-file');
    await registry.close(fileId, 7);
    expect(registry.openCount).toBe(1);
    expect(registry.infoOf(fileId, 9)?.name).toBe('text.pdf');
    expect(await registry.isUnchangedOnDisk(fileId, 9)).toBe(true);
    expect(registry.documentOwner(fixture('text.pdf'))).toBe(9);
    await registry.close(fileId, 9);
    expect(registry.openCount).toBe(0);
  });
});
