// Jedes Dokument in einem eigenen Fenster, Tabs herausziehen und zusammenführen (ADR 0026)
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, TEXT_PDF } from '../fixtures/expectations';
import { expectWindowCount, launchApp, menuClick, mergeAllWindows, waitForDocument, windowWithTitle } from './app';

const FORM_PAGES = 1;
const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// Kopien der Test-PDFs, weil einige Tests speichern
function copies(...names: string[]): { dir: string; files: string[] } {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  tempDirs.push(dir);
  const files = names.map((name) => {
    const file = path.join(dir, name);
    copyFileSync(fixture(name), file);
    return file;
  });
  return { dir, files };
}

async function answerOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: picked })) as typeof dialog.showOpenDialog;
  }, paths);
}

// Zieht einen Tab mit der Maus um (dx, dy) Pixel und lässt ihn los
async function dragTab(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId('tab').nth(index).boundingBox();
  if (!box) throw new Error('kein Tab');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 2 });
  await page.mouse.move(x + dx, y + dy, { steps: 2 });
  await page.mouse.up();
}

async function setBounds(app: ElectronApplication, title: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
  await app.evaluate(({ BrowserWindow }, args) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith(args.title));
    if (!win) throw new Error(`Fenster ${args.title} fehlt`);
    win.setBounds(args.bounds);
  }, { title, bounds });
}

test('ein leeres Fenster übernimmt das Dokument, jedes weitere öffnet ein eigenes Fenster', async () => {
  const { app, page, close } = await launchApp();
  await answerOpenDialog(app, [fixture('text.pdf')]);
  await page.getByTestId('open-button').click();
  await waitForDocument(page, TEXT_PDF.pages);
  await expectWindowCount(app, 1);

  await answerOpenDialog(app, [fixture('formular.pdf')]);
  await page.getByTestId('open-button').click();
  await expectWindowCount(app, 2);
  await waitForDocument(await windowWithTitle(app, 'formular.pdf'), FORM_PAGES);
  await expect(page.getByTestId('tab')).toHaveCount(1);

  // Schon offen: kein weiteres Fenster, kein zweiter Tab
  await answerOpenDialog(app, [fixture('formular.pdf')]);
  await page.getByTestId('open-button').click();
  await page.waitForTimeout(500);
  await expectWindowCount(app, 2);
  await expect((await windowWithTitle(app, 'formular.pdf')).getByTestId('tab')).toHaveCount(1);
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('window.mergeAll')?.enabled)).toBe(true);
  await close();
});

test('neues leeres Dokument aus einem Fenster mit Dokument öffnet ein eigenes Fenster im Bearbeitungsmodus', async () => {
  const { app, page, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await menuClick(app, 'file.newBlank');
  await expectWindowCount(app, 2);
  const blank = await windowWithTitle(app, 'Unbenannt.pdf');
  await waitForDocument(blank, 1);
  await expect(blank.getByTestId('content-edit-toolbar')).toBeVisible();
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await close();
});

test('Tab aus der Leiste ziehen und per Menü in ein neues Fenster bewegen', async () => {
  const { app, close } = await launchApp([fixture('text.pdf'), fixture('formular.pdf')]);
  await expectWindowCount(app, 2);
  await waitForDocument(await windowWithTitle(app, 'text.pdf'), TEXT_PDF.pages);
  const page = await mergeAllWindows(app);
  await expect(page.getByTestId('tab')).toHaveCount(2);

  // Herausziehen: Loslassen unterhalb der Tableiste (text.pdf)
  const textIndex = (await page.getByTestId('tab').first().textContent())?.includes('text.pdf') ? 0 : 1;
  await dragTab(page, textIndex, 0, 300);
  await expectWindowCount(app, 2);
  await expect(page.getByTestId('tab')).toHaveCount(1);
  const detached = await windowWithTitle(app, 'text.pdf');
  await waitForDocument(detached, TEXT_PDF.pages);

  // Ziehen innerhalb der Leiste und ein einzelner Tab bewirken nichts
  await dragTab(detached, 0, 40, 0);
  await dragTab(detached, 0, 0, 300);
  await page.waitForTimeout(500);
  await expectWindowCount(app, 2);

  // Wieder zusammen, dann über das Menü „Tab in neues Fenster bewegen“
  const merged = await mergeAllWindows(app);
  await expect(merged.getByTestId('tab')).toHaveCount(2);
  await menuClick(app, 'window.moveTabToNewWindow');
  await expectWindowCount(app, 2);
  await expect(merged.getByTestId('tab')).toHaveCount(1);
  await close();
});

test('Tab auf ein anderes Fenster ziehen führt beide zusammen', async () => {
  const { app, close } = await launchApp([fixture('text.pdf'), fixture('formular.pdf')]);
  await expectWindowCount(app, 2);
  const target = await windowWithTitle(app, 'text.pdf');
  await waitForDocument(target, TEXT_PDF.pages);
  const source = await windowWithTitle(app, 'formular.pdf');
  await waitForDocument(source, FORM_PAGES);
  await setBounds(app, 'text.pdf', { x: 0, y: 0, width: 800, height: 600 });
  await setBounds(app, 'formular.pdf', { x: 850, y: 0, width: 800, height: 600 });
  // Nach links aus dem Fenster heraus, über das andere Fenster
  await dragTab(source, 0, -500, 200);
  await expectWindowCount(app, 1);
  await expect(target.getByTestId('tab')).toHaveCount(2);
  await expect(target.getByTestId('tab').filter({ hasText: 'formular.pdf' })).toHaveCount(1);
  await close();
});

test('ungespeicherte Änderungen wandern mit; Speichern schreibt in die Originaldatei', async () => {
  const { files } = copies('text.pdf', 'formular.pdf');
  const [textFile, formFile] = files as [string, string];
  const { app, close } = await launchApp([textFile, formFile]);
  await expectWindowCount(app, 2);
  const textWindow = await windowWithTitle(app, 'text.pdf');
  await waitForDocument(textWindow, TEXT_PDF.pages);
  await waitForDocument(await windowWithTitle(app, 'formular.pdf'), FORM_PAGES);
  // Änderung im hinteren Fenster (text.pdf); das Menü wirkt auf das vordere, deshalb den Befehl direkt schicken
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('text.pdf'));
    win?.webContents.send('menu:command', { command: 'pages.rotateClockwise' });
  });
  await expect(textWindow.getByTestId('tab-dirty')).toHaveCount(1);
  const before = readFileSync(textFile);

  // Zusammenführen: Das Fenster mit Änderungen gibt seinen Tab ohne Rückfrage ab und schließt sich
  const page = await mergeAllWindows(app);
  await expect(page.getByTestId('tab')).toHaveCount(2);
  const textTab = page.getByTestId('tab').filter({ hasText: 'text.pdf' });
  await expect(textTab.getByTestId('tab-dirty')).toHaveCount(1);
  expect(readFileSync(textFile).equals(before)).toBe(true);

  await textTab.click();
  await waitForDocument(page, TEXT_PDF.pages);
  await menuClick(app, 'file.save');
  await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const saved = await PDFDocument.load(readFileSync(textFile));
  expect(saved.getPage(0).getRotation().angle).toBe(90);
  await close();
});
