// Phase 7: Profi-Funktionen. Arbeitet auf Kopien der Test-PDFs; Systemdialoge werden ersetzt.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, TEXT_PDF } from '../fixtures/expectations';
import { launchApp, menuClick, waitForDocument } from './app';
import { inspectWithPdfKit } from './pdfkit';

const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
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
