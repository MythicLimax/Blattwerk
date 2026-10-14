// Phase 6: Werkzeuge. Arbeitet auf Kopien der Test-PDFs.
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
