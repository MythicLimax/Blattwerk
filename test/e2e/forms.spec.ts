// Phase 4: Formulare und Unterschrift. Arbeitet auf Kopien der Test-PDFs.
import { expect, test, type Page } from '@playwright/test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fixture } from '../fixtures/expectations';
import { launchApp, menuClick, waitForDocument, type AppHandle } from './app';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

const tempDirs: string[] = [];
test.afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function openCopy(name: string, pages: number): Promise<AppHandle & { file: string; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  tempDirs.push(dir);
  const file = path.join(dir, `kopie-${name}`);
  copyFileSync(fixture(name), file);
  const handle = await launchApp([file], { userData: dir });
  await waitForDocument(handle.page, pages);
  return { ...handle, file, dir };
}

// Feld der pdf.js-Formularebene über die Objektnummer des Widgets
const field = (page: Page, ref: string) => page.locator(`[data-testid="active-pane"] .annotationLayer [data-element-id="${ref}"]`);

async function fieldValues(file: string): Promise<Record<string, unknown>> {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const pdf = await task.promise;
  const map = (await pdf.getFieldObjects()) as unknown as Map<string, Array<{ value: unknown; page: number }>> | null;
  const result: Record<string, unknown> = {};
  for (const [name, list] of map ?? []) result[name] = list.find((f) => f.page >= 0)?.value;
  await task.destroy();
  return result;
}

test.describe('Formulare', () => {
  test('Formular ausfüllen, speichern und wieder öffnen', async () => {
    const handle = await openCopy('formular.pdf', 1);
    const { page, app, file } = handle;
    await field(page, '9R').fill('Erika Müller');
    await field(page, '13R').check();
    await field(page, '24R').check();
    await field(page, '35R').selectOption('Schweiz');
    await expect(page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(app, 'file.save');
    await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(await fieldValues(file)).toMatchObject({ name: 'Erika Müller', einverstanden: 'Yes', farbe: 'gruen', land: 'Schweiz' });
    // Nach dem Neuladen zeigt die Ansicht die gespeicherten Werte
    await expect(field(page, '9R')).toHaveValue('Erika Müller');
    await expect(field(page, '13R')).toBeChecked();
    await handle.close();
  });

  test('ungespeicherte Formulareingaben lösen die Nachfrage beim Schließen aus', async () => {
    const handle = await openCopy('formular.pdf', 1);
    const { page, app } = handle;
    await field(page, '9R').fill('Nur getippt');
    await expect(page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(app, 'file.close');
    await expect(page.getByTestId('prompt-unsaved')).toBeVisible();
    await page.getByTestId('prompt-cancel').click();
    // Zurücksetzen auf den alten Wert zählt nicht mehr als Änderung
    await field(page, '9R').fill('');
    await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
    await handle.close();
  });
});
