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
import { inspectWithPdfKit } from './pdfkit';

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

// Position der Kommentarebene von Seite 1, sobald sie sich nicht mehr bewegt (nach Zoom und Neuanordnung)
async function stableOverlayBox(page: Page) {
  const overlay = page.getByTestId('annotation-overlay-0');
  let last = '';
  for (let i = 0; i < 50; i++) {
    const box = await overlay.boundingBox();
    const key = JSON.stringify(box);
    if (box && key === last) return box;
    last = key;
    await page.waitForTimeout(100);
  }
  throw new Error('Seite kommt nicht zur Ruhe');
}

async function stampCount(file: string): Promise<number> {
  const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const pdf = await task.promise;
  let count = 0;
  for (let i = 1; i <= pdf.numPages; i++) count += (await (await pdf.getPage(i)).getAnnotations()).filter((a) => a.subtype === 'Stamp').length;
  await task.destroy();
  return count;
}

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

test.describe('Unterschrift', () => {
  test('zeichnen, für später speichern, setzen und speichern', async () => {
    const handle = await openCopy('text.pdf', 12);
    const { page, app, file, dir } = handle;
    await page.getByTestId('sign-button').click();
    // Noch keine gespeicherte Unterschrift: Der Dialog zum Anlegen öffnet sich direkt.
    await expect(page.getByTestId('signature-create-dialog')).toBeVisible();
    await expect(page.getByTestId('signature-use')).toBeDisabled();
    const pad = await page.getByTestId('signature-pad').boundingBox();
    if (!pad) throw new Error('kein Zeichenfeld');
    await page.mouse.move(pad.x + 40, pad.y + 120);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(pad.x + 40 + i * 20, pad.y + 120 - Math.sin(i / 2) * 40);
    await page.mouse.up();
    await page.getByTestId('signature-use').click();
    await expect(page.getByTestId('signature-hint')).toBeVisible();
    await menuClick(app, 'view.fitPage');
    await expect(page.getByTestId('zoom-select')).toHaveValue('page-fit');
    const box = await stableOverlayBox(page);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.8);
    await expect(page.getByTestId('signature-hint')).toHaveCount(0);
    await expect(page.getByTestId('tab-dirty')).toHaveCount(1);
    await menuClick(app, 'file.save');
    await expect(page.getByTestId('tab-dirty')).toHaveCount(0);
    expect(await stampCount(file)).toBe(1);
    if (process.platform === 'darwin') expect(inspectWithPdfKit(file).pages[0]).toContain('Stamp');
    await handle.close();

    // Beim nächsten Start steht die gespeicherte Unterschrift zur Auswahl.
    const second = await launchApp([file], { userData: dir });
    await waitForDocument(second.page, 12);
    await second.page.getByTestId('sign-button').click();
    await expect(second.page.getByTestId('signature-choose-dialog')).toBeVisible();
    await expect(second.page.getByTestId('signature-saved')).toHaveCount(1);
    await second.page.getByTestId('signature-saved').click();
    await expect(second.page.getByTestId('signature-hint')).toBeVisible();
    await second.page.keyboard.press('Escape');
    await expect(second.page.getByTestId('signature-hint')).toHaveCount(0);
    await second.close();
  });

  test('getippte Unterschrift ohne Speichern', async () => {
    const handle = await openCopy('text.pdf', 12);
    const { page, app } = handle;
    await page.getByTestId('sign-button').click();
    await page.getByTestId('signature-mode-type').click();
    await page.getByTestId('signature-name').fill('Erika Mustermann');
    await page.getByTestId('signature-keep').uncheck();
    await page.getByTestId('signature-use').click();
    await menuClick(app, 'view.fitPage');
    await expect(page.getByTestId('zoom-select')).toHaveValue('page-fit');
    const box = await stableOverlayBox(page);
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.85);
    await page.getByTestId('sidebar-comments').click();
    await expect(page.getByTestId('comment-card').filter({ hasText: 'Unterschrift' })).toHaveCount(1);
    // Nicht gespeichert: beim nächsten Klick öffnet sich wieder der Dialog zum Anlegen
    await page.getByTestId('sign-button').click();
    await expect(page.getByTestId('signature-create-dialog')).toBeVisible();
    await handle.close();
  });
});
