// Phase 7: Profi-Funktionen. Arbeitet auf Kopien der Test-PDFs; Systemdialoge werden ersetzt.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, TEXT_PDF } from '../fixtures/expectations';
import { launchApp, menuClick, removeTempDir, waitForDocument, windowWithTitle } from './app';
import { inspectWithPdfKit } from './pdfkit';
import { taggedPdf } from '../fixtures/tagged';
import { wordDocument } from '../fixtures/docx';

const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) removeTempDir(dir);
});

const TEST_ID = path.resolve(import.meta.dirname, '..', 'fixtures', 'certs', 'test-id.p12');

// Öffnen- und Sichern-Dialoge der Reihe nach beantworten
async function stubDialogs(app: ElectronApplication, open: string[], save: string[]): Promise<void> {
  await app.evaluate(
    ({ dialog }, answers) => {
      const openQueue = [...answers.open];
      const saveQueue = [...answers.save];
      dialog.showOpenDialog = (async () => {
        const next = openQueue.shift();
        return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => {
        const next = saveQueue.shift();
        return next ? { canceled: false, filePath: next } : { canceled: true, filePath: '' };
      }) as typeof dialog.showSaveDialog;
    },
    { open, save },
  );
}

test.describe('Digitale Signaturen', () => {
  test('mit Zertifikat sichtbar unterschreiben, speichern, Prüfergebnis; zweite Signatur mit eigener ID', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'vertrag.pdf');
    copyFileSync(fixture('text.pdf'), file);
    const signedFile = path.join(dir, 'vertrag-unterschrieben.pdf');
    const ownId = path.join(dir, 'meine-id.p12');
    const handle = await launchApp([file], { userData: dir });
    const { page, app } = handle;
    await waitForDocument(page, TEXT_PDF.pages);
    await stubDialogs(app, [TEST_ID], [signedFile, ownId, signedFile]);

    await menuClick(app, 'tools.certify');
    const dialog = page.getByTestId('certify-dialog');
    await dialog.getByTestId('certify-pick').click();
    await expect(dialog.getByTestId('certify-id')).toHaveText('test-id.p12');
    await dialog.getByTestId('certify-password').fill('test');
    await dialog.getByTestId('certify-reason').fill('Freigabe');
    await dialog.getByTestId('certify-confirm').click();
    await expect(page.getByTestId('certify-hint')).toBeVisible();
    const overlay = await page.getByTestId('certify-placement-0').boundingBox();
    if (!overlay) throw new Error('keine Seite');
    // Im sichtbaren Teil der Seite (bei diesem Zoom ist sie höher als das Fenster)
    await page.mouse.move(overlay.x + overlay.width * 0.55, overlay.y + 300);
    await page.mouse.down();
    await page.mouse.move(overlay.x + overlay.width * 0.75, overlay.y + 340, { steps: 4 });
    await page.mouse.move(overlay.x + overlay.width * 0.9, overlay.y + 370, { steps: 4 });
    await page.mouse.up();
    // Gespeichert unter neuem Namen, danach geprüft
    await expect(page.getByTestId('tab')).toContainText('vertrag-unterschrieben.pdf');
    await waitForDocument(page, TEXT_PDF.pages);
    const bar = page.getByTestId('signatures-bar');
    await expect(bar).toHaveAttribute('data-summary', 'valid');
    await expect(bar).toContainText('Erika Mustermann');
    expect(readFileSync(signedFile).toString('latin1')).toContain('ETSI.CAdES.detached');
    // Apple Vorschau (PDFKit) öffnet die unterschriebene Datei
    if (process.platform === 'darwin') expect(inspectWithPdfKit(signedFile).ok).toBe(true);

    // Eigene ID erstellen und unsichtbar ein zweites Mal unterschreiben
    await menuClick(app, 'tools.certify');
    await page.getByTestId('certify-create').click();
    const create = page.getByTestId('create-id-dialog');
    await create.getByTestId('create-id-name').fill('Max Muster');
    await create.getByTestId('create-id-password').fill('geheim1');
    await create.getByTestId('create-id-repeat').fill('geheim1');
    await create.getByTestId('create-id-confirm').click();
    await expect(create).toHaveCount(0, { timeout: 30_000 });
    await expect(dialog.getByTestId('certify-id')).toHaveText('meine-id.p12');
    await dialog.getByTestId('certify-password').fill('geheim1');
    await dialog.getByTestId('certify-visible').uncheck();
    await dialog.getByTestId('certify-confirm').click();
    await waitForDocument(page, TEXT_PDF.pages);
    await expect(bar).toContainText('alle 2 Signaturen gültig');
    await page.getByTestId('signatures-details').click();
    const items = page.getByTestId('signature-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Danach wurde das Dokument geändert');
    await expect(items.nth(1)).toContainText('seitdem nicht geändert');
    await expect(items.nth(1)).toContainText('Selbst ausgestelltes Zertifikat');
    await handle.close();
  });
});

test.describe('PDF/A', () => {
  test('prüfen, als PDF/A-2b speichern, neue Datei besteht die Prüfung', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'bericht.pdf');
    copyFileSync(fixture('text.pdf'), file);
    const archived = path.join(dir, 'bericht-archiv.pdf');
    const handle = await launchApp([file], { userData: dir });
    const { page, app } = handle;
    await waitForDocument(page, TEXT_PDF.pages);
    await stubDialogs(app, [], [archived]);

    await menuClick(app, 'tools.pdfa');
    const dialog = page.getByTestId('pdfa-dialog');
    await expect(dialog.getByTestId('pdfa-verdict')).toHaveAttribute('data-compliant', 'false');
    await expect(dialog.getByTestId('pdfa-issues')).toContainText('Helvetica');
    await dialog.getByTestId('pdfa-convert').click();
    await expect(dialog).toBeHidden();
    // Die neue Datei öffnet sich in einem eigenen Fenster (ADR 0026); Menübefehle gehen an das vordere Fenster
    await expect.poll(() => existsSync(archived), { timeout: 15_000 }).toBe(true);
    const archivedWindow = await windowWithTitle(app, 'bericht-archiv.pdf');
    await waitForDocument(archivedWindow, TEXT_PDF.pages);
    const text = readFileSync(archived).toString('latin1');
    expect(text).toContain('pdfaid:part>2<');
    if (process.platform === 'darwin') expect(inspectWithPdfKit(archived).ok).toBe(true);

    await menuClick(app, 'tools.pdfa');
    await expect(archivedWindow.getByTestId('pdfa-verdict')).toHaveAttribute('data-compliant', 'true');
    await expect(archivedWindow.getByTestId('pdfa-issues')).toHaveCount(0);
    await handle.close();
  });
});

test.describe('Barrierefreiheit', () => {
  test('Tags anzeigen, prüfen, Sprache und Titel beheben', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'getaggt.pdf');
    writeFileSync(file, await taggedPdf());
    const handle = await launchApp([file], { userData: dir });
    const { page, app } = handle;
    await waitForDocument(page, 1);

    await page.getByTestId('sidebar-tags').click();
    const tags = page.getByTestId('tags');
    await expect(tags.getByTestId('tag-item').first()).toHaveAttribute('data-role', 'Document');
    await expect(tags.locator('[data-role="H1"]')).toBeVisible();
    await expect(tags.locator('[data-role="Figure"]')).toHaveCount(2);
    await expect(tags).toContainText('Diagramm der Umsätze');

    await menuClick(app, 'tools.accessibility');
    const dialog = page.getByTestId('accessibility-dialog');
    const check = (code: string) => dialog.locator(`[data-code="${code}"]`);
    await expect(check('tagged')).toHaveAttribute('data-status', 'passed');
    await expect(check('language')).toHaveAttribute('data-status', 'failed');
    await expect(check('figure-alt')).toHaveAttribute('data-status', 'failed');
    await expect(dialog.getByTestId('accessibility-lang')).toHaveValue('de-DE');
    await dialog.getByTestId('accessibility-title').fill('Jahresbericht');
    await dialog.getByTestId('accessibility-fix').click();
    // Neuer Stand: Prüfung läuft erneut
    await expect(check('language')).toHaveAttribute('data-status', 'passed', { timeout: 15_000 });
    await expect(check('title')).toHaveAttribute('data-status', 'passed');
    await expect(check('tab-order')).toHaveAttribute('data-status', 'passed');
    await expect(check('figure-alt')).toHaveAttribute('data-status', 'failed');
    await expect(dialog.getByTestId('accessibility-fix')).toHaveCount(0);
    await handle.close();
  });

  test('Dokument ohne Tags: Hinweis in der Seitenleiste', async () => {
    const handle = await launchApp([fixture('text.pdf')]);
    const { page } = handle;
    await waitForDocument(page, TEXT_PDF.pages);
    await page.getByTestId('sidebar-tags').click();
    await expect(page.getByTestId('tags-empty')).toBeVisible();
    await page.getByTestId('tags-check').click();
    await expect(page.locator('[data-code="tagged"]')).toHaveAttribute('data-status', 'failed');
    await handle.close();
  });
});

test.describe('PDF aus Textdokument', () => {
  test('Word-Datei umwandeln: zwei Seiten, Lesezeichen, Tags', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
    tempDirs.push(dir);
    const source = path.join(dir, 'bericht.docx');
    writeFileSync(source, wordDocument());
    const target = path.join(dir, 'bericht.pdf');
    const handle = await launchApp([], { userData: dir });
    const { page, app } = handle;
    await stubDialogs(app, [source], [target]);
    await menuClick(app, 'file.fromDocument');
    await waitForDocument(page, 2);
    expect(readFileSync(target).subarray(0, 5).toString()).toBe('%PDF-');
    if (process.platform === 'darwin') expect(inspectWithPdfKit(target).ok).toBe(true);
    // Überschriften werden zu Lesezeichen und Tags
    await page.getByTestId('sidebar-bookmarks').click();
    await expect(page.getByTestId('outline-item').first()).toHaveText('Jahresbericht 2026');
    await page.getByTestId('sidebar-tags').click();
    await expect(page.getByTestId('tags').locator('[data-role="H1"]').first()).toBeAttached();
    await handle.close();
  });
});

test('Alternativtext einer Abbildung in der Seitenleiste „Tags“ eintragen und speichern', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'getaggt.pdf');
  writeFileSync(file, await taggedPdf());
  const { page, app, close } = await launchApp([file], { userData: dir });
  await waitForDocument(page, 1);
  await page.getByTestId('sidebar-tags').click();
  const tags = page.getByTestId('tags');
  await expect(tags).toContainText('(ohne Alternativtext)');
  await tags.getByTestId('tag-alt-edit').first().click();
  await page.getByTestId('tag-alt-input').fill('Foto der Schule');
  await page.getByTestId('tag-alt-save').click();
  await expect(tags).toContainText('Foto der Schule');
  await expect(tags).not.toContainText('(ohne Alternativtext)');
  await expect(page.getByTestId('tab-dirty')).toHaveCount(1);
  await menuClick(app, 'file.save');
  await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
  const { checkAccessibility } = await import('../../src/workers/pdfium/accessibility');
  const report = await checkAccessibility(new Uint8Array(readFileSync(file)));
  expect(JSON.stringify(report.tree)).toContain('Foto der Schule');
  await close();
});
