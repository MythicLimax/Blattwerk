// Phase 3: Seiten organisieren. Arbeitet auf Kopien der Test-PDFs; Systemdialoge werden im Hauptprozess ersetzt.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { COMMENTS_PDF, fixture, imageFixture, PASSWORDS, TEXT_PDF } from '../fixtures/expectations';
import { expectWindowCount, launchApp, menuClick, waitForDocument, windowWithTitle, type AppHandle } from './app';
import { inspectWithPdfKit } from './pdfkit';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  tempDirs.push(dir);
  return dir;
}

async function openCopy(name: string, pages: number): Promise<AppHandle & { file: string; dir: string }> {
  const dir = tempDir();
  const file = path.join(dir, `kopie-${name}`);
  copyFileSync(fixture(name), file);
  const handle = await launchApp([file], { userData: dir });
  await waitForDocument(handle.page, pages);
  return { ...handle, file, dir };
}

// Antworten für die nächsten Öffnen-Dialoge (Dateien wählen, Ordner wählen) und Sichern-Dialoge
async function stubDialogs(app: ElectronApplication, open: string[][], save: string[] = []): Promise<void> {
  await app.evaluate(
    ({ dialog }, answers) => {
      const openQueue = [...answers.open];
      const saveQueue = [...answers.save];
      dialog.showOpenDialog = (async () => {
        const next = openQueue.shift();
        return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => {
        const next = saveQueue.shift();
        return next ? { canceled: false, filePath: next } : { canceled: true, filePath: '' };
      }) as typeof dialog.showSaveDialog;
    },
    { open, save },
  );
}

const status = (page: Page) => page.getByTestId('organize-status');
const cell = (page: Page, number: number) => page.locator(`[data-testid="organize-page"][data-page="${number}"]`);

async function organize(page: Page) {
  await page.getByTestId('organize-button').click();
  await expect(page.getByTestId('organize-view')).toBeVisible();
}

// Ursprüngliche Seitennummern über die Fußzeile „Seite N“ des Text-PDFs (null: Seite ohne Fußzeile)
async function footers(file: string, password?: string): Promise<Array<number | null>> {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), password, verbosity: 0 });
  const pdf = await task.promise;
  const result: Array<number | null> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    const footer = content.items.map((item) => ('str' in item ? item.str : '')).find((s) => /^Seite \d+$/.test(s));
    result.push(footer ? Number(footer.slice(6)) : null);
  }
  await task.destroy();
  return result;
}

async function pageCount(file: string): Promise<number> {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const pdf = await task.promise;
  const count = pdf.numPages;
  await task.destroy();
  return count;
}

async function save(page: Page, app: ElectronApplication) {
  await menuClick(app, 'file.save');
  await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
}

test.describe('Seiten organisieren', () => {
  test('Raster: drehen, löschen, verschieben, rückgängig, speichern', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app, file } = handle;
    const original = readFileSync(file);
    await organize(page);
    await expect(status(page)).toHaveText('1 Seite ausgewählt');

    await cell(page, 2).click();
    await page.getByTestId('organize-rotate-right').click();
    await expect(page.getByTestId('tab-dirty')).toHaveCount(1);

    await cell(page, 3).click();
    await page.getByTestId('organize-delete').click();
    await expect(status(page)).toHaveText('11 Seiten');

    // Seite 1 per Ziehen hinter Seite 4
    await cell(page, 1).click();
    await cell(page, 1).dragTo(cell(page, 4), { targetPosition: { x: 150, y: 60 } });
    await expect(status(page)).toHaveText('1 Seite ausgewählt');
    await expect(cell(page, 4)).toHaveAttribute('aria-selected', 'true');

    // Rückgängig nimmt nur das Verschieben zurück (Auswahl wieder auf Seite 1), Wiederholen stellt es her.
    // Beide Befehle direkt hintereinander: Wiederholen wartet, bis Rückgängig fertig ist.
    await menuClick(app, 'edit.undo');
    await menuClick(app, 'edit.redo');
    await menuClick(app, 'edit.undo');
    await expect(cell(page, 1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pages-working')).toHaveCount(0);
    await menuClick(app, 'edit.redo');
    await expect(cell(page, 4)).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 1)).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('pages-working')).toHaveCount(0);

    // Mehrfachauswahl mit Umschalt und Entfernen-Taste
    await cell(page, 5).click();
    await cell(page, 6).click({ modifiers: ['Shift'] });
    await expect(status(page)).toHaveText('2 Seiten ausgewählt');
    await page.keyboard.press('Backspace');
    await expect(status(page)).toHaveText('9 Seiten');

    // Datei auf der Platte ist bis zum Speichern unverändert
    expect(readFileSync(file).equals(original)).toBe(true);
    await save(page, app);
    // Original 1-12: Seite 2 gedreht, 3 gelöscht, 1 hinter 4, dann die Seiten an Position 5 und 6 gelöscht
    expect(await footers(file)).toEqual([2, 4, 5, 1, 8, 9, 10, 11, 12]);
    // Inkrementell: das Original steht am Anfang
    expect(readFileSync(file).subarray(0, original.length).equals(original)).toBe(true);
    await handle.close();
  });

  test('leere Seiten und Seiten aus PDFs und Bildern einfügen', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app, file } = handle;
    await stubDialogs(app, [[fixture('formular.pdf'), imageFixture('viertel.png'), imageFixture('foto.jpg')]]);
    await organize(page);
    await menuClick(app, 'pages.insertFromFile');
    await expect(page.getByTestId('insert-pages-dialog')).toBeVisible();
    await expect(page.getByTestId('insert-pages-dialog')).toContainText('3 Seiten werden eingefügt');
    await page.getByTestId('insert-relation').selectOption('before');
    await page.getByTestId('insert-anchor').selectOption('first');
    await page.getByTestId('insert-pages-ok').click();
    await expect(status(page)).toHaveText('3 Seiten ausgewählt');
    await expect(cell(page, 15)).toBeAttached();

    await menuClick(app, 'pages.insertBlank');
    await page.getByTestId('insert-count').fill('2');
    await page.getByTestId('insert-anchor').selectOption('last');
    await page.getByTestId('insert-pages-ok').click();
    await expect(status(page)).toHaveText('2 Seiten ausgewählt');

    await save(page, app);
    expect(await footers(file)).toEqual([null, null, null, ...Array.from({ length: 12 }, (_, i) => i + 1), null, null]);
    if (process.platform === 'darwin') expect(inspectWithPdfKit(file).pages).toHaveLength(17);
    await handle.close();
  });

  test('kennwortgeschütztes PDF einfügen fragt nach dem Kennwort', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app } = handle;
    await stubDialogs(app, [[fixture('verschluesselt.pdf')]]);
    await organize(page);
    await menuClick(app, 'pages.insertFromFile');
    await expect(page.getByTestId('source-password-dialog')).toBeVisible();
    await page.getByTestId('source-password-input').fill('falsch');
    await page.getByTestId('source-password-ok').click();
    await expect(page.getByTestId('source-password-dialog')).toContainText('falsch');
    await page.getByTestId('source-password-input').fill(PASSWORDS.user);
    await page.getByTestId('source-password-ok').click();
    await page.getByTestId('insert-pages-ok').click();
    await expect(status(page)).toHaveText('12 Seiten ausgewählt');
    await expect(cell(page, 24)).toBeAttached();
    await handle.close();
  });

  test('Seiten extrahieren: neue Datei wird gespeichert und geöffnet', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app, dir } = handle;
    const target = path.join(dir, 'auszug.pdf');
    await stubDialogs(app, [], [target]);
    await menuClick(app, 'pages.extract');
    await page.getByTestId('extract-pages-input').fill('2-3, 7');
    await page.getByTestId('extract-pages-ok').click();
    // Das neue Dokument öffnet in einem eigenen Fenster (ADR 0026)
    await expectWindowCount(app, 2);
    await waitForDocument(await windowWithTitle(app, 'auszug.pdf'), 3);
    await expect(page.getByTestId('tab')).toHaveCount(1);
    expect(await footers(target)).toEqual([2, 3, 7]);
    // Das Ausgangsdokument bleibt unverändert und ohne ungespeicherte Änderungen
    await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
    await handle.close();
  });

  test('Seiten einzeln extrahieren und danach löschen', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app, dir } = handle;
    const folder = path.join(dir, 'einzeln');
    mkdirSync(folder);
    await stubDialogs(app, [[folder]]);
    await menuClick(app, 'pages.extract');
    await page.getByTestId('extract-pages-input').fill('1, 12');
    await page.getByTestId('extract-separate').check();
    await page.getByTestId('extract-delete').check();
    await page.getByTestId('extract-pages-ok').click();
    await expect(page.getByTestId('notices')).toContainText('2 Dateien');
    await expect.poll(() => readdirSync(folder).sort()).toEqual(['kopie-text – Seite 1.pdf', 'kopie-text – Seite 12.pdf']);
    await expect(page.getByTestId('page-count')).toHaveText('von 10');
    expect(await footers(path.join(folder, 'kopie-text – Seite 12.pdf'))).toEqual([12]);
    await handle.close();
  });

  test('Dokument teilen nach Seitenanzahl und an Lesezeichen', async () => {
    const handle = await openCopy(TEXT_PDF.file, TEXT_PDF.pages);
    const { page, app, dir } = handle;
    const byCount = path.join(dir, 'je5');
    const byBookmarks = path.join(dir, 'kapitel');
    mkdirSync(byCount);
    mkdirSync(byBookmarks);
    await stubDialogs(app, [[byCount], [byBookmarks]]);

    await menuClick(app, 'pages.split');
    await page.getByTestId('split-size').fill('5');
    await expect(page.getByTestId('split-summary')).toHaveText('Ergibt 3 Dateien.');
    await page.getByTestId('split-ok').click();
    // Nur fertige Dateien zählen: Während des Schreibens liegt eine temporäre Datei „.Name.tmp“ daneben (atomicWrite)
    const finished = (dir: string) => readdirSync(dir).filter((name) => !name.startsWith('.'));
    await expect.poll(() => finished(byCount).length).toBe(3);
    const parts = finished(byCount).sort();
    expect(parts[0]).toBe('kopie-text – Teil 1.pdf');
    expect(await pageCount(path.join(byCount, parts[2] as string))).toBe(2);

    // Lesezeichen der obersten Ebene: Seiten 1, 3, 6, 10
    await menuClick(app, 'pages.split');
    await page.getByTestId('split-by-bookmarks').check();
    await expect(page.getByTestId('split-summary')).toHaveText('Ergibt 4 Dateien.');
    await page.getByTestId('split-ok').click();
    await expect.poll(() => finished(byBookmarks).length).toBe(4);
    const chapters = finished(byBookmarks).sort();
    const counts = await Promise.all(chapters.map((name) => pageCount(path.join(byBookmarks, name))));
    expect(counts).toEqual([2, 3, 4, 3]);
    await handle.close();
  });

  test('Dateien zusammenführen (PDF und Bild) ohne geöffnetes Dokument', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'zusammen.pdf');
    const handle = await launchApp([], { userData: dir });
    const { page, app } = handle;
    await stubDialogs(app, [[fixture('text.pdf')], [imageFixture('foto.jpg'), fixture('kommentare.pdf')]], [target]);
    await menuClick(app, 'file.combine');
    await expect(page.getByTestId('combine-dialog')).toBeVisible();
    await page.getByTestId('combine-add').click();
    await expect(page.getByTestId('combine-entry')).toHaveCount(1);
    await page.getByTestId('combine-add').click();
    await expect(page.getByTestId('combine-entry')).toHaveCount(3);
    // Bild an den Anfang
    await page.getByTestId('combine-entry').nth(1).getByRole('button', { name: 'Nach oben' }).click();
    await expect(page.getByTestId('combine-entry').first()).toContainText('foto.jpg');
    await expect(page.getByTestId('combine-dialog')).toContainText('15 Seiten');
    await page.getByTestId('combine-ok').click();
    await waitForDocument(page, 15);
    expect(existsSync(target)).toBe(true);
    const numbers = await footers(target);
    expect(numbers.slice(0, 2)).toEqual([null, 1]);
    await handle.close();
  });

  test('PDF aus Bildern erstellen', async () => {
    const dir = tempDir();
    const target = path.join(dir, 'bilder.pdf');
    const handle = await launchApp([], { userData: dir });
    const { page, app } = handle;
    await stubDialogs(app, [[imageFixture('foto.jpg'), imageFixture('viertel.png'), imageFixture('transparent.png')]], [target]);
    await menuClick(app, 'file.fromImages');
    await waitForDocument(page, 3);
    if (process.platform === 'darwin') {
      const png = path.join(dir, 'seite1.png');
      expect(inspectWithPdfKit(target, png).pages).toHaveLength(3);
      expect(existsSync(png)).toBe(true);
    }
    await handle.close();
  });

  test('Kommentare bleiben bei Seitenänderungen erhalten', async () => {
    const handle = await openCopy(COMMENTS_PDF.file, COMMENTS_PDF.pages);
    const { page, app, file } = handle;
    await page.getByTestId('sidebar-comments').click();
    await expect(page.getByTestId('comment-card')).toHaveCount(COMMENTS_PDF.comments);
    // Neue, noch nicht gespeicherte Notiz auf Seite 1
    await page.getByTestId('comment-tools-button').click();
    await menuClick(app, 'view.fitPage');
    const box = await page.getByTestId('annotation-overlay-0').boundingBox();
    if (!box) throw new Error('keine Kommentarebene');
    await page.getByTestId('tool-note').click();
    await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.8);
    await page.keyboard.type('Neue Notiz');
    await expect(page.getByTestId('comment-card')).toHaveCount(COMMENTS_PDF.comments + 1);

    // Seite 1 hinter Seite 2 verschieben
    await organize(page);
    await cell(page, 1).dragTo(cell(page, 2), { targetPosition: { x: 150, y: 60 } });
    await expect(cell(page, 2)).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('organize-close').click();
    await page.getByTestId('sidebar-comments').click();
    await expect(page.getByTestId('comment-card')).toHaveCount(COMMENTS_PDF.comments + 1);
    await expect(page.getByTestId('comments-panel')).toContainText('Seite 2');
    await save(page, app);
    await handle.close();

    const again = await launchApp([file]);
    await waitForDocument(again.page, COMMENTS_PDF.pages);
    await again.page.getByTestId('sidebar-comments').click();
    await expect(again.page.getByTestId('comment-card')).toHaveCount(COMMENTS_PDF.comments + 1);
    await expect(again.page.getByTestId('comment-card').filter({ hasText: 'Neue Notiz' })).toHaveCount(1);
    await again.close();
  });

  test('gesperrte Dokumente: Seiten nicht änderbar, Extrahieren erlaubt', async () => {
    const { page, close } = await launchApp([fixture('eingeschraenkt.pdf')]);
    await waitForDocument(page, TEXT_PDF.pages);
    await organize(page);
    await expect(page.getByTestId('organize-view')).toContainText('erlaubt kein');
    await expect(page.getByTestId('organize-rotate-right')).toBeDisabled();
    await expect(page.getByTestId('organize-insert-file')).toBeDisabled();
    await expect(page.getByTestId('organize-extract')).toBeEnabled();
    await close();
  });
});
