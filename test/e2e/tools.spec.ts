// Phase 6: Werkzeuge. Arbeitet auf Kopien der Test-PDFs.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixture, PASSWORDS, TEXT_PDF } from '../fixtures/expectations';
import { launchApp, menuClick, waitForDocument } from './app';
import { unlockWithPdfKit } from './pdfkit';

const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function copyOf(name: string): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  copyFileSync(fixture(name), file);
  return { dir, file };
}

test.describe('Kennwortschutz', () => {
  test('setzen, speichern, mit Kennwort öffnen, eingeschränkt, entfernen', async () => {
    const { dir, file } = copyOf('text.pdf');
    let handle = await launchApp([file], { userData: dir });
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await menuClick(handle.app, 'tools.security');
    const dialog = handle.page.getByTestId('security-dialog');
    await dialog.getByTestId('security-open').check();
    await dialog.getByTestId('security-open-password').fill('oeffnen');
    await dialog.getByTestId('security-open-repeat').fill('falsch');
    await dialog.getByTestId('security-restrict').check();
    await dialog.getByTestId('security-permissions-password').fill('rechte');
    await dialog.getByTestId('security-permissions-repeat').fill('rechte');
    await dialog.getByTestId('security-printing').selectOption('none');
    await dialog.getByTestId('security-apply').click();
    await expect(dialog.getByTestId('security-problem')).toContainText('stimmen nicht überein');
    await dialog.getByTestId('security-open-repeat').fill('oeffnen');
    await dialog.getByTestId('security-apply').click();
    await expect(dialog).toHaveCount(0);
    await waitForDocument(handle.page, TEXT_PDF.pages);
    // In dieser Sitzung gilt das Berechtigungskennwort: volle Rechte
    await expect(handle.page.getByTestId('print-button')).toBeEnabled();
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(handle.app, 'file.save');
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(readFileSync(file).toString('latin1')).toMatch(/\/Encrypt/);
    if (process.platform === 'darwin') {
      expect(unlockWithPdfKit(file, 'oeffnen')).toMatchObject({ opened: true, encrypted: true, unlocked: true, allowsPrinting: false });
      expect(unlockWithPdfKit(file, 'falsch')).toMatchObject({ unlocked: false });
    }
    await handle.close();

    // Neu öffnen: Kennwort nötig, Drucken verboten
    handle = await launchApp([file], { userData: dir });
    await expect(handle.page.getByTestId('password-dialog')).toBeVisible();
    await handle.page.getByTestId('password-input').fill('oeffnen');
    await handle.page.keyboard.press('Enter');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await expect(handle.page.getByTestId('print-button')).toBeDisabled();

    // Entfernen verlangt das Berechtigungskennwort
    await menuClick(handle.app, 'tools.security');
    const owner = handle.page.getByTestId('security-owner-dialog');
    await owner.getByTestId('security-owner-input').fill('oeffnen');
    await owner.getByTestId('security-owner-confirm').click();
    await expect(owner.getByTestId('security-owner-wrong')).toBeVisible();
    await owner.getByTestId('security-owner-input').fill('rechte');
    await owner.getByTestId('security-owner-confirm').click();
    await handle.page.getByTestId('security-remove').click();
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await expect(handle.page.getByTestId('print-button')).toBeEnabled();
    // Rückgängig stellt den geschützten Stand wieder her (mit seinem Kennwort)
    await menuClick(handle.app, 'edit.undo');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await expect(handle.page.getByTestId('print-button')).toBeDisabled();
    await menuClick(handle.app, 'edit.redo');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(handle.app, 'file.save');
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(readFileSync(file).toString('latin1')).not.toMatch(/\/Encrypt/);
    await handle.close();
  });

  test('mit dem Berechtigungskennwort geöffnet: keine Einschränkungen', async () => {
    const { dir, file } = copyOf('verschluesselt.pdf');
    const handle = await launchApp([file], { userData: dir });
    await expect(handle.page.getByTestId('password-dialog')).toBeVisible();
    await handle.page.getByTestId('password-input').fill(PASSWORDS.owner);
    await handle.page.keyboard.press('Enter');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    // Ohne Abfrage direkt zu den Einstellungen
    await menuClick(handle.app, 'tools.security');
    await expect(handle.page.getByTestId('security-dialog')).toBeVisible();
    await handle.page.getByTestId('security-remove').click();
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(handle.app, 'file.save');
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(readFileSync(file).toString('latin1')).not.toMatch(/\/Encrypt/);
    await handle.close();
  });
});

// Ordner- und Sichern-Dialog des Systems ersetzen
async function stubDialogs(app: ElectronApplication, folder: string, saveAs: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, answers) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [answers.folder] })) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: answers.saveAs })) as typeof dialog.showSaveDialog;
    },
    { folder, saveAs },
  );
}

test.describe('Exportieren', () => {
  test('als Bilder (PNG und JPEG, Seitenbereich) und als Text', async () => {
    const { dir, file } = copyOf('text.pdf');
    const handle = await launchApp([file], { userData: dir });
    await waitForDocument(handle.page, TEXT_PDF.pages);
    const out = mkdtempSync(path.join(tmpdir(), 'blattwerk-export-'));
    tempDirs.push(out);
    await stubDialogs(handle.app, out, path.join(out, 'auszug'));

    await menuClick(handle.app, 'file.exportImages');
    const dialog = handle.page.getByTestId('export-images-dialog');
    await dialog.getByTestId('export-dpi').selectOption('72');
    await dialog.getByTestId('stamp-pages-range').check();
    await dialog.getByTestId('stamp-pages').fill('2-3');
    await dialog.getByTestId('export-images-confirm').click();
    await expect(handle.page.getByTestId('notices')).toContainText('2 Bilder');
    const pngs = readdirSync(out).filter((name) => name.endsWith('.png')).sort();
    expect(pngs).toEqual(['text – Seite 02.png', 'text – Seite 03.png']);
    const png = readFileSync(path.join(out, pngs[0] ?? ''));
    // Breite und Höhe im PNG-Kopf: A4 bei 72 dpi
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([595, 842]);

    // Noch einmal: vorhandene Dateien bleiben, JPEG für alle Seiten
    await menuClick(handle.app, 'file.exportImages');
    await dialog.getByTestId('export-format').selectOption('jpeg');
    await dialog.getByTestId('export-dpi').selectOption('72');
    await dialog.getByTestId('export-images-confirm').click();
    await expect(handle.page.getByTestId('notices')).toContainText('12 Bilder');
    const jpgs = readdirSync(out).filter((name) => name.endsWith('.jpg'));
    expect(jpgs).toHaveLength(12);
    expect([...readFileSync(path.join(out, 'text – Seite 01.jpg')).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

    await menuClick(handle.app, 'file.exportText');
    await expect(handle.page.getByTestId('notices')).toContainText('auszug.txt');
    const text = readFileSync(path.join(out, 'auszug.txt'), 'utf8');
    expect(text).toContain('Testdokument mit Text');
    expect(text).toContain('Die Umlaute ä, ö und ü sowie das ß');
    expect(text).toContain('Hier steht die Suchprobe Nummer 2');
    await handle.close();
  });

  test('verboten, wenn das Dokument das Kopieren nicht erlaubt', async () => {
    const { dir, file } = copyOf('verschluesselt.pdf');
    const handle = await launchApp([file], { userData: dir });
    await handle.page.getByTestId('password-input').fill(PASSWORDS.user);
    await handle.page.keyboard.press('Enter');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await menuClick(handle.app, 'file.exportText');
    await expect(handle.page.getByTestId('notices')).toContainText('verbieten das Kopieren');
    await handle.close();
  });
});

test.describe('Komprimieren', () => {
  test('verkleinert ein PDF mit großem Bild, Rückgängig und Speichern', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
    tempDirs.push(dir);
    const file = path.join(dir, 'foto.pdf');
    const { PDFDocument } = await import('@cantoo/pdf-lib');
    const jpeg = (await import('jpeg-js')).default;
    const width = 2400;
    const height = 1800;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const x = i % width;
      const y = Math.floor(i / width);
      data.set([(x / width) * 255, (y / height) * 255, 128 + 60 * Math.sin(x / 30), 255], i * 4);
    }
    const doc = await PDFDocument.create();
    const image = await doc.embedJpg(jpeg.encode({ width, height, data }, 95).data);
    doc.addPage([595, 842]).drawImage(image, { x: 20, y: 300, width: 555, height: 416 });
    writeFileSync(file, await doc.save());
    const before = statSync(file).size;

    const handle = await launchApp([file], { userData: dir });
    await waitForDocument(handle.page, 1);
    await menuClick(handle.app, 'tools.compress');
    await handle.page.getByTestId('compress-strong').check();
    await handle.page.getByTestId('compress-confirm').click();
    await expect(handle.page.getByTestId('notices')).toContainText('kleiner');
    await waitForDocument(handle.page, 1);
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(handle.app, 'file.save');
    await expect(handle.page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(statSync(file).size).toBeLessThan(before / 3);
    await handle.close();
  });

  test('verschlüsselte Dokumente: Hinweis auf den Kennwortschutz', async () => {
    const { dir, file } = copyOf('verschluesselt.pdf');
    const handle = await launchApp([file], { userData: dir });
    await handle.page.getByTestId('password-input').fill(PASSWORDS.owner);
    await handle.page.keyboard.press('Enter');
    await waitForDocument(handle.page, TEXT_PDF.pages);
    await menuClick(handle.app, 'tools.compress');
    await expect(handle.page.getByTestId('notices')).toContainText('Kennwortschutz');
    await expect(handle.page.getByTestId('compress-dialog')).toHaveCount(0);
    await handle.close();
  });
});
