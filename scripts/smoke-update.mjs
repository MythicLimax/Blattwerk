// Prüft das Update ohne Internet mit der fertig gebauten App (ADR 0025), unsichtbar und in einem Testordner:
// App „installieren“, daneben eine neu signierte Fassung mit Version 99.0.0 als Update bereitlegen, starten, auf
// „Jetzt aktualisieren“ klicken und prüfen, dass die App danach ausgetauscht ist und das Update aufgeräumt wurde.
// Aufruf: node scripts/smoke-update.mjs <Pfad zu Blattwerk.app>
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('Pfad zur App fehlt');
const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-update-'));
const installed = path.join(dir, 'Programme', 'Blattwerk.app');
const profile = path.join(dir, 'Profil');
const update = path.join(profile, 'Updates', 'Blattwerk.app');
const version = (bundle) => execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();

mkdirSync(path.dirname(installed), { recursive: true });
mkdirSync(path.dirname(update), { recursive: true });
execFileSync('/usr/bin/ditto', [source, installed]);
execFileSync('/usr/bin/ditto', [source, update]);
execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', '99.0.0', path.join(update, 'Contents', 'Info.plist')]);
execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', update], { stdio: 'ignore' });

const before = version(installed);
const port = 9334;
const child = spawn(path.join(installed, 'Contents', 'MacOS', 'Blattwerk'), [`--remote-debugging-port=${port}`], {
  // Unsichtbar: kein Fenster, kein Dock-Symbol; nach dem Update wird die App nicht neu geöffnet
  env: { ...process.env, BLATTWERK_USER_DATA: profile, BLATTWERK_HIDDEN: '1' },
  stdio: 'ignore',
});
const exited = new Promise((resolve) => child.once('exit', resolve));
try {
  let browser;
  for (let i = 0; i < 120 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 250));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error('App nicht erreichbar');
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('Kein Fenster');
  const banner = page.getByTestId('update-banner');
  await banner.waitFor({ timeout: 30000 });
  const offered = (await banner.textContent())?.includes('99.0.0');
  console.log(`Update angeboten: ${offered ? 'ok' : 'FEHLER'} (installiert ${before})`);
  if (!offered) process.exitCode = 1;
  await page.getByTestId('update-install').click();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 20000))]);
  // Das Hilfsskript tauscht die App nach dem Beenden aus
  let after = before;
  for (let i = 0; i < 120 && after !== '99.0.0'; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      after = version(installed);
    } catch {
      // gerade im Austausch
    }
  }
  const signed = (() => {
    try {
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  const ok = after === '99.0.0' && !existsSync(update) && signed;
  console.log(`Update eingespielt: ${ok ? 'ok' : 'FEHLER'} (jetzt ${after}, Update aufgeräumt: ${!existsSync(update)}, Signatur gültig: ${signed})`);
  if (!ok) process.exitCode = 1;
} finally {
  child.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
