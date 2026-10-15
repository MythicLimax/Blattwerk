// Oberflächentests für Fehler, die die Code-Prüfung in Phase 1 gefunden hat.
import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fixture, LARGE_PDF, TEXT_PDF } from '../fixtures/expectations';
import { currentPage, launchApp, menuClick, menuItemState, waitForDocument } from './app';

const activePane = (page: Page) => page.locator('[data-testid="active-pane"]');

test('mehrere Dateien öffnen: Abbrechen der Kennwortabfrage hält die übrigen nicht auf', async () => {
  const { page, app, close } = await launchApp();
  // Systemdialog ersetzen: Er liefert zwei Dateien, die verschlüsselte zuerst.
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog;
  }, [fixture('verschluesselt.pdf'), fixture('text.pdf')]);
  await page.getByTestId('open-button').click();
  await expect(page.getByTestId('tab')).toHaveCount(2);
  // text.pdf lädt, obwohl für die erste Datei noch das Kennwort fehlt.
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('tab').first().click();
  await expect(page.getByTestId('password-dialog')).toBeVisible();
  await page.getByTestId('password-dialog').getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await waitForDocument(page, TEXT_PDF.pages);
  await close();
});

test('Schließen funktioniert auch bei Kennwortabfrage und Ladefehler', async () => {
  const { page, app, close } = await launchApp([fixture('verschluesselt.pdf')]);
  await expect(page.getByTestId('password-dialog')).toBeVisible();
  expect(await menuItemState(app, 'file.close')).toMatchObject({ enabled: true });
  await menuClick(app, 'file.close');
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await close();
});

test('Druck abbrechen durch Schließen des Tabs hängt nicht', async () => {
  test.skip(!existsSync(LARGE_PDF), 'Große Testdatei fehlt');
  const { page, app, close } = await launchApp([LARGE_PDF]);
  await waitForDocument(page, 600);
  await page.getByTestId('print-button').click();
  await expect(page.getByTestId('print-progress')).toBeVisible();
  await menuClick(app, 'file.close');
  await expect(page.getByTestId('print-progress')).toHaveCount(0);
  await expect(page.getByTestId('start-screen')).toBeVisible();
  await close();
});

test('Einzelne Seite: Trackpad und Pfeil runter blättern am Seitenende um', async () => {
  const { page, app, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('view-mode-select').selectOption('single');
  await menuClick(app, 'view.fitPage');
  await expect.poll(() => currentPage(page)).toBe(1);
  // Künstliche Wheel-Ereignisse scrollen nicht von selbst; der Test stellt deshalb vorher den Rand ein,
  // den echtes Scrollen erreichen würde.
  const swipe = (deltaY: number) =>
    page.getByTestId('viewer-container').evaluate((element, dy) => {
      element.scrollTop = dy > 0 ? element.scrollHeight : 0;
      for (let i = 0; i < 6; i++) {
        element.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
      }
    }, deltaY);
  await swipe(30);
  await expect.poll(() => currentPage(page)).toBe(2);
  // Kurz warten, bis die Nachlaufsperre vorbei ist, dann zurück.
  await page.waitForTimeout(600);
  await swipe(-30);
  await expect.poll(() => currentPage(page)).toBe(1);
  await page.getByTestId('viewer-container').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.focus();
  });
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => currentPage(page)).toBe(2);
  await close();
});

test('Klick in der Werkzeugleiste nimmt dem Dokument nicht die Tastatur', async () => {
  const { page, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('viewer-container').click({ position: { x: 5, y: 5 } });
  await page.getByRole('button', { name: 'Vergrößern' }).click();
  const before = await page.getByTestId('viewer-container').evaluate((el) => el.scrollTop);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.getByTestId('viewer-container').evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await close();
});

test('Suchergebnis anklicken wählt genau diesen Treffer aus', async () => {
  const { page, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('search-button').click();
  await page.getByTestId('search-input').fill(TEXT_PDF.searchTerm);
  await expect(page.getByTestId('search-results').locator('li')).toHaveCount(TEXT_PDF.searchHits);
  await page.getByTestId('search-results').locator('li').nth(4).click();
  await expect(page.getByTestId('search-status')).toHaveText(`5 von ${TEXT_PDF.searchHits} Treffern`);
  await expect.poll(() => currentPage(page)).toBe(9);
  await expect(activePane(page).locator('.textLayer .highlight.selected')).toBeVisible();
  // Weitersuchen geht vom angeklickten Treffer aus.
  await page.getByTestId('search-input').press('Enter');
  await expect(page.getByTestId('search-status')).toHaveText(`6 von ${TEXT_PDF.searchHits} Treffern`);
  await close();
});

test('Suchfeld leeren entfernt die Ergebnisse; Tabwechsel behält die Markierungen', async () => {
  const { page, close } = await launchApp([fixture('text.pdf'), fixture('kaputte-xref.pdf')]);
  await expect(page.getByTestId('tab')).toHaveCount(2);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('search-button').click();
  await page.getByTestId('search-input').fill(TEXT_PDF.searchTerm);
  await expect(page.getByTestId('search-results').locator('li')).toHaveCount(TEXT_PDF.searchHits);

  await page.getByTestId('tab').first().click();
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('tab').last().click();
  await expect(activePane(page).locator('.textLayer .highlight').first()).toBeVisible();
  // Der Tabwechsel holt den Fokus nicht ins Suchfeld.
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).not.toBe('search-input');

  await page.getByTestId('search-input').fill('');
  await page.waitForTimeout(400);
  await expect(page.getByTestId('search-results')).toHaveCount(0);
  await expect(page.getByTestId('search-status')).toHaveText('Gib einen Begriff ein und drücke die Eingabetaste.');
  await close();
});

test('„Liste leeren“ auf dem Startbildschirm leert auch die Liste des Systems', async () => {
  const first = await launchApp([fixture('text.pdf')], { keepUserData: true });
  await waitForDocument(first.page, TEXT_PDF.pages);
  await first.app.close();
  const second = await launchApp([], { userData: first.userData });
  await second.app.evaluate(({ app }) => {
    const g = globalThis as unknown as { __cleared: number };
    g.__cleared = 0;
    app.clearRecentDocuments = () => {
      g.__cleared++;
    };
  });
  await second.page.getByRole('button', { name: 'Liste leeren' }).click();
  await expect(second.page.getByTestId('recent-list')).toHaveCount(0);
  expect(await second.app.evaluate(() => (globalThis as unknown as { __cleared: number }).__cleared)).toBe(1);
  await second.close();
});

test('Absturz der Anzeige: Neu laden stellt die App wieder her', async () => {
  const { page, app, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer());
  // Nach dem Neuladen zeigt das (einzige) Fenster wieder den Startbildschirm. Abfrage direkt beim Fenster,
  // weil Playwright die Seite nach einem Absturz nicht weiterverfolgt.
  await expect
    .poll(
      () =>
        app.evaluate(async ({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents;
          if (!contents || contents.isCrashed() || contents.isLoading()) return false;
          return contents
            .executeJavaScript('Boolean(document.querySelector(\'[data-testid="start-screen"]\'))')
            .catch(() => false);
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await close();
});

test('Beschriftung erscheint beim Überfahren unter dem Symbol', async () => {
  const { page, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  const button = page.getByTestId('print-button');
  const tooltip = page.getByTestId('tooltip');
  await button.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(/Drucken/);
  const [buttonBox, tipBox] = [await button.boundingBox(), await tooltip.boundingBox()];
  expect(tipBox && buttonBox && tipBox.y).toBeGreaterThanOrEqual((buttonBox?.y ?? 0) + (buttonBox?.height ?? 0));
  await page.mouse.move(5, 400);
  await expect(tooltip).toBeHidden();
  await close();
});

test('Fenster schließen fragt bei Änderungen nach und beendet dann die App (auch unter macOS)', async () => {
  const { page, app } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await menuClick(app, 'pages.rotateClockwise');
  await expect(page.getByTestId('tab-dirty')).toHaveCount(1);
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  // Wie ein Klick auf den roten Knopf
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  // Abbrechen: Fenster und App bleiben
  await page.getByTestId('prompt-cancel').click();
  await expect(page.getByTestId('tab')).toHaveCount(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await page.getByTestId('prompt-discard').click();
  await exited;
});

test('Neuer Text beginnt an der Klickstelle, die erste Zeile liegt mittig darauf und springt beim Übernehmen nicht', async () => {
  const { page, app, close } = await launchApp([fixture('text.pdf')]);
  await waitForDocument(page, TEXT_PDF.pages);
  await page.getByTestId('content-edit-button').click();
  for (const zoom of ['view.fitPage', 'view.actualSize'] as const) {
    await menuClick(app, zoom);
    await page.getByTestId('content-tool-text').click();
    const overlay = await page.getByTestId('content-edit-overlay-0').boundingBox();
    if (!overlay) throw new Error('keine Ebene');
    const x = overlay.x + overlay.width * 0.5;
    const y = overlay.y + overlay.height * (zoom === 'view.fitPage' ? 0.8 : 0.25);
    await page.mouse.click(x, y);
    const editor = page.getByTestId('content-text-editor');
    const box = await editor.boundingBox();
    if (!box) throw new Error('keine Eingabe');
    // Text beginnt an der Klickstelle (Rahmen und Innenabstand: 3 px), Zeile mittig
    expect(Math.abs(box.x + 3 - x)).toBeLessThan(1.5);
    expect(Math.abs(box.y + box.height / 2 - y)).toBeLessThan(2);
    await page.keyboard.type(`Klick ${zoom}`);
    await page.keyboard.press('Meta+Enter');
    const placed = page.locator(`[data-testid="content-object"][data-text="Klick ${zoom}"]`);
    await expect(placed).toBeVisible();
    const after = await placed.boundingBox();
    if (!after) throw new Error('kein Text');
    expect(Math.abs(after.x - x)).toBeLessThan(3);
    expect(Math.abs(after.y + after.height / 2 - y)).toBeLessThan(3);
  }
  await close();
});
