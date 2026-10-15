// Startet die fertig gebaute App (nicht den Entwicklungsstand) mit einer Kopie eines Test-PDFs und prüft über die
// Chromium-Debug-Schnittstelle, ob das Dokument angezeigt wird und ob Kommentieren, Formularfelder anlegen
// (pdf-lib, nachgeladener Teil des Workers) und Speichern (PDFium-Worker aus dem App-Paket) funktionieren.
// Aufruf: node scripts/smoke-packaged.mjs <Pfad zu Blattwerk.app>
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Zählt die Fenster eines Prozesses, die auf dem Bildschirm sind (JavaScript for Automation, ohne Oberfläche)
const WINDOW_COUNT_SCRIPT = `
ObjC.import('CoreGraphics');
function run(argv) {
  const pid = Number(argv[0]);
  const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0));
  let count = 0;
  for (let i = 0; i < list.count; i++) {
    if (ObjC.unwrap(list.objectAtIndex(i).objectForKey('kCGWindowOwnerPID')) === pid) count++;
  }
  return String(count);
}
`;

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
  // Unsichtbar: kein Fenster und kein Dock-Symbol, der Auftraggeber arbeitet nebenher weiter
  env: { ...process.env, BLATTWERK_USER_DATA: userData, BLATTWERK_HIDDEN: '1' },
  stdio: 'ignore',
});
try {
  let browser;
  // Beim ersten Start nach dem Bauen prüft macOS die neu signierte App; das kann einige Sekunden dauern.
  for (let i = 0; i < 120 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 250));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error('App nicht erreichbar');
  // Die Debug-Schnittstelle ist oft schon erreichbar, bevor das Fenster existiert
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('Kein Fenster');
  await page.getByTestId('page-count').waitFor({ timeout: 15000 });
  // Muss unsichtbar laufen: macOS fragen, ob die App ein Fenster auf dem Bildschirm hat (die Seite selbst hält sich bei
  // ungedrosseltem Zeichnen für sichtbar)
  if (process.platform === 'darwin') {
    const script = path.join(userData, 'fenster.js');
    writeFileSync(script, WINDOW_COUNT_SCRIPT);
    const windows = Number(execFileSync('osascript', ['-l', 'JavaScript', script, String(child.pid)], { encoding: 'utf8' }).trim());
    console.log(`Fenster unsichtbar: ${windows === 0 ? 'ok' : `FEHLER (${windows} sichtbar)`}`);
    if (windows !== 0) process.exitCode = 1;
  }
  const count = await page.getByTestId('page-count').textContent();
  await page.locator('.pdfViewer .page canvas').first().waitFor({ timeout: 15000 });
  const url = page.url();
  console.log(`Fertige App: ${count}, geladen von ${url}`);
  if (count !== 'von 12' || !url.startsWith('app://bundle/')) process.exitCode = 1;

  // Apples Liquid Glass: native Erweiterung aus dem Paket geladen (macOS 26+)
  if (process.platform === 'darwin') {
    // Als Ausdruck im Fenster ausgewertet (dieses Skript läuft in Node)
    const glass = await page.evaluate('window.blattwerk.getAppInfo().then((info) => info.nativeGlass)');
    const marked = await page.evaluate('document.documentElement.dataset.nativeGlass === "on"');
    console.log(`Liquid Glass von macOS: ${glass && marked ? 'ok' : 'nicht aktiv'}`);
  }

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

  // Textfeld anlegen (Modus „Formular bearbeiten“) und speichern
  await page.getByTestId('form-edit-button').click();
  await page.getByTestId('field-tool-text').click();
  const formBox = await page.getByTestId('form-edit-overlay-0').boundingBox();
  if (!formBox) throw new Error('Keine Bearbeitungsebene für Formulare');
  await page.mouse.click(formBox.x + 80, formBox.y + 220);
  await page.getByTestId('field-name').fill('Rauchtest');
  await page.getByTestId('field-dialog-ok').click();
  await page.locator('[data-testid="form-field"][data-field-name="Rauchtest"]').waitFor({ timeout: 30000 });
  await page.getByTestId('save-button').click();
  await page.getByTestId('tab-dirty').waitFor({ state: 'detached', timeout: 30000 });
  const withField = readFileSync(file).toString('latin1');
  // Neue Feldnamen schreibt pdf-lib als UTF-16 (hexadezimal); geprüft wird deshalb der Feldtyp.
  const fieldOk = /\/FT\s*\/Tx/.test(withField);
  console.log(`Formularfeld in der fertigen App: ${fieldOk ? 'ok' : 'FEHLER'}`);
  if (!fieldOk) process.exitCode = 1;
  await browser.close();
} finally {
  // Erst nach dem Beenden aufräumen (die App schreibt sonst noch in ihr Profil)
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
