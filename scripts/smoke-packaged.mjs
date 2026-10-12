// Startet die fertig gebaute App (nicht den Entwicklungsstand) mit einer Kopie eines Test-PDFs und prüft über die
// Chromium-Debug-Schnittstelle, ob das Dokument angezeigt wird und ob Kommentieren und Speichern
// (PDFium-Worker aus dem App-Paket) funktionieren.
// Aufruf: node scripts/smoke-packaged.mjs <Pfad zu Blattwerk.app>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = process.argv[2];
if (!appPath) throw new Error('Pfad zur App fehlt');
const binary = path.join(appPath, 'Contents', 'MacOS', 'Blattwerk');
const userData = mkdtempSync(path.join(tmpdir(), 'blattwerk-smoke-'));
const port = 9333;
const file = path.join(userData, 'rauchtest.pdf');
copyFileSync(path.join(root, 'test/fixtures/pdfs/text.pdf'), file);
const originalSize = readFileSync(file).length;

const child = spawn(binary, [`--remote-debugging-port=${port}`, file], {
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

  // Rechteck zeichnen und über die Werkzeugleiste speichern
  await page.getByTestId('comment-tools-button').click();
  await page.getByTestId('tool-square').click();
  const box = await page.getByTestId('annotation-overlay-0').boundingBox();
  if (!box) throw new Error('Keine Kommentarebene');
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 140, { steps: 4 });
  await page.mouse.up();
  await page.getByTestId('save-button').click();
  await page.getByTestId('tab-dirty').waitFor({ state: 'detached', timeout: 30000 });
  const saved = readFileSync(file);
  const ok = saved.length > originalSize && /\/Subtype\s*\/Square/.test(saved.toString('latin1'));
  console.log(`Speichern in der fertigen App: ${ok ? 'ok' : 'FEHLER'} (${originalSize} → ${saved.length} Byte)`);
  if (!ok) process.exitCode = 1;
  await browser.close();
} finally {
  child.kill();
  rmSync(userData, { recursive: true, force: true });
}
