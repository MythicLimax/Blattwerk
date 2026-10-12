// Startet die fertig gebaute App (nicht den Entwicklungsstand) mit einem Test-PDF und prüft über die
// Chromium-Debug-Schnittstelle, ob das Dokument angezeigt wird.
// Aufruf: node scripts/smoke-packaged.mjs <Pfad zu Blattwerk.app>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = process.argv[2];
if (!appPath) throw new Error('Pfad zur App fehlt');
const binary = path.join(appPath, 'Contents', 'MacOS', 'Blattwerk');
const userData = mkdtempSync(path.join(tmpdir(), 'blattwerk-smoke-'));
const port = 9333;

const child = spawn(binary, [`--remote-debugging-port=${port}`, path.join(root, 'test/fixtures/pdfs/text.pdf')], {
  env: { ...process.env, BLATTWERK_USER_DATA: userData },
  stdio: 'ignore',
});
try {
  let browser;
  for (let i = 0; i < 40 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 250));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error('App nicht erreichbar');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error('Kein Fenster');
  await page.getByTestId('page-count').waitFor({ timeout: 15000 });
  const count = await page.getByTestId('page-count').textContent();
  await page.locator('.pdfViewer .page canvas').first().waitFor({ timeout: 15000 });
  const url = page.url();
  console.log(`Fertige App: ${count}, geladen von ${url}`);
  if (count !== 'von 12' || !url.startsWith('app://bundle/')) process.exitCode = 1;
  await browser.close();
} finally {
  child.kill();
  rmSync(userData, { recursive: true, force: true });
}
