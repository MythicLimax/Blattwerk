// Verschieben folgt dem Zeiger ohne Verzögerung (Fehlerbericht: Textfelder hingen beim Ziehen hinterher). Nach jeder
// Bewegung muss das gezogene Objekt im nächsten Bild schon an der neuen Stelle stehen, für alle Arten von Objekten.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, TEXT_PDF } from '../fixtures/expectations';
import { launchApp, menuClick, waitForDocument } from './app';

const nextFrame = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

// Zieht von start aus in kleinen Schritten und misst nach jedem Schritt, wie weit das Objekt dem Zeiger hinterherhinkt
async function maxLag(page: Page, moving: () => Locator, start: { x: number; y: number }): Promise<number> {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Erster Schritt löst das Ziehen aus (Schwelle), danach wird gemessen
  await page.mouse.move(start.x + 6, start.y + 4);
  await nextFrame(page);
  const origin = await moving().boundingBox();
  if (!origin) throw new Error('kein gezogenes Objekt');
  let worst = 0;
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(start.x + 6 + i * 12, start.y + 4 + i * 7);
    await nextFrame(page);
    const box = await moving().boundingBox();
    if (!box) throw new Error('Objekt verschwunden');
    worst = Math.max(worst, Math.hypot(box.x - origin.x - i * 12, box.y - origin.y - i * 7));
  }
  await page.mouse.up();
  return worst;
}

test('Inhalt bearbeiten: verschobener Text folgt dem Zeiger sofort', async () => {
  const { page, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('content-edit-button').click();
  const heading = page.locator('[data-testid="content-object"][data-text="Inhaltsverzeichnis"]').first();
  const box = await heading.boundingBox();
  if (!box) throw new Error('Zeile fehlt');
  expect(await maxLag(page, () => page.getByTestId('content-ghost').first(), { x: box.x + 10, y: box.y + box.height / 2 })).toBeLessThan(2);
  await close();
});

test('Kommentare: verschobenes Rechteck folgt dem Zeiger sofort', async () => {
  const { page, app, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('comment-tools-button').click();
  await menuClick(app, 'view.fitPage');
  const overlay = await page.getByTestId('annotation-overlay-0').boundingBox();
  if (!overlay) throw new Error('keine Ebene');
  await page.getByTestId('tool-square').click();
  await page.mouse.move(overlay.x + overlay.width * 0.2, overlay.y + overlay.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.4, overlay.y + overlay.height * 0.8, { steps: 6 });
  await page.mouse.up();
  const hit = page.locator('[data-annotation-hit]').first();
  const box = await hit.boundingBox();
  if (!box) throw new Error('Kein Rechteck');
  // Am Rand anfassen (Rahmen ohne Füllung reagiert nur auf den Strich)
  expect(await maxLag(page, () => hit, { x: box.x + 2, y: box.y + box.height / 2 })).toBeLessThan(2);
  await close();
});

test('Formular bearbeiten: verschobenes Feld folgt dem Zeiger sofort', async () => {
  const { page, close } = await launchApp([fixture('formular.pdf')]);
  await waitForDocument(page, 1);
  await page.getByTestId('form-edit-button').click();
  await expect(page.getByTestId('form-edit-toolbar')).toBeVisible();
  const field = page.locator('[data-testid="form-field"]').first();
  await expect(field).toBeVisible();
  const box = await field.boundingBox();
  if (!box) throw new Error('kein Feld');
  expect(await maxLag(page, () => page.locator('[data-testid="form-field"]').first(), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBeLessThan(2);
  await close();
});
