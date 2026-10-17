// Hilfsfunktionen für die Oberflächentests: App starten, Befehle aus dem Menü auslösen, Zustand lesen.
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as unknown as string;
export const ROOT = path.resolve(import.meta.dirname, '../..');

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
  userData: string;
  printDir: string;
  close: () => Promise<void>;
}

export async function launchApp(files: string[] = [], options: { userData?: string; keepUserData?: boolean } = {}): Promise<AppHandle> {
  const userData = options.userData ?? mkdtempSync(path.join(tmpdir(), 'blattwerk-e2e-'));
  const printDir = path.join(userData, 'druck');
  const app = await electron.launch({
    executablePath: electronPath,
    args: [ROOT, ...files],
    cwd: ROOT,
    // Playwright würde sonst den hellen Modus erzwingen; die App soll der Systemeinstellung folgen.
    colorScheme: null,
    env: {
      ...process.env,
      BLATTWERK_E2E: '1',
      BLATTWERK_USER_DATA: userData,
      BLATTWERK_E2E_PRINT_DIR: printDir,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('toolbar')).toBeVisible();
  return {
    app,
    page,
    userData,
    printDir,
    close: async () => {
      // Mit ungespeicherten Kommentaren fragt die App nach; im Test werden die Änderungen verworfen.
      let closed = false;
      const closing = app.close().finally(() => {
        closed = true;
      });
      // Jedes Dokument hat sein eigenes Fenster: Rückfragen können in jedem Fenster erscheinen.
      while (!closed) {
        for (const win of app.windows()) {
          try {
            const discard = win.getByTestId('prompt-discard');
            if (await discard.isVisible()) await discard.click({ timeout: 1000 });
          } catch {
            // Fenster inzwischen geschlossen
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await closing;
      if (!options.keepUserData && !options.userData) rmSync(userData, { recursive: true, force: true });
    },
  };
}

// Löst einen Menübefehl aus, so wie ein Klick im nativen Menü.
export async function menuClick(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`Menüpunkt ${itemId} fehlt`);
    item.click();
  }, id);
}

export async function menuItemState(app: ElectronApplication, id: string): Promise<{ enabled: boolean; checked: boolean } | null> {
  return app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    return item ? { enabled: item.enabled, checked: item.checked } : null;
  }, id);
}

export async function waitForDocument(page: Page, pageCount: number): Promise<void> {
  await expect(page.getByTestId('page-count')).toHaveText(`von ${pageCount}`);
  await expect(page.locator('[data-testid="active-pane"] .pdfViewer .page canvas').first()).toBeVisible();
}

export async function currentPage(page: Page): Promise<number> {
  return Number(await page.getByTestId('page-input').inputValue());
}

// Mehrere Fenster (ADR 0026): Anzahl abwarten, Fenster eines Dokuments am Titel („Name – Blattwerk“) finden
export async function expectWindowCount(app: ElectronApplication, count: number): Promise<void> {
  await expect.poll(() => app.windows().length).toBe(count);
}

export async function windowWithTitle(app: ElectronApplication, title: string): Promise<Page> {
  let found: Page | null = null;
  await expect
    .poll(async () => {
      for (const win of app.windows()) {
        const current = await win.title().catch(() => '');
        if (current === title || current.startsWith(`${title} – `)) {
          found = win;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  if (!found) throw new Error(`Kein Fenster mit dem Titel ${title}`);
  return found;
}

// „Fenster → Alle Fenster zusammenführen“: Alle Tabs landen im vorderen Fenster (dem zuletzt geöffneten).
// Liefert das verbleibende Fenster.
export async function mergeAllWindows(app: ElectronApplication): Promise<Page> {
  await menuClick(app, 'window.mergeAll');
  await expectWindowCount(app, 1);
  const [win] = app.windows();
  if (!win) throw new Error('kein Fenster');
  return win;
}
