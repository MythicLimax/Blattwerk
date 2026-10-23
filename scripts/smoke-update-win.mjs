// Prüft das Update unter Windows mit dem fertigen Installationsprogramm (ADR 0025), in einem Testordner: still
// installieren, dasselbe Installationsprogramm als „Version 99.0.0“ in den Update-Ordner legen, die App starten, auf
// „Jetzt aktualisieren“ klicken und prüfen, dass das Installationsprogramm die App neu installiert und neu startet.
// (Aufräumen prüft der Test nicht: Die „neue“ Version ist in Wahrheit dieselbe, ihr Update bleibt also liegen.)
// Läuft in CI auf Windows (dort sind Fenster ohnehin sichtbar). Aufruf: node scripts/smoke-update-win.mjs <Setup.exe>
import { chromium } from '@playwright/test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const setup = process.argv[2] && path.resolve(process.argv[2]);
if (!setup || process.platform !== 'win32') throw new Error('Aufruf unter Windows mit Pfad zum Installationsprogramm');
const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-update-'));
const target = path.join(dir, 'Programme', 'Blattwerk');
const exe = path.join(target, 'Blattwerk.exe');
const profile = path.join(dir, 'Profil');
const updates = path.join(profile, 'Updates');
const update = path.join(updates, 'Blattwerk-Setup-99.0.0.exe');
const log = path.join(updates, 'update.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const running = () => spawnSync('tasklist', ['/FI', 'IMAGENAME eq Blattwerk.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout.includes('Blattwerk.exe');

// NSIS will „/D=…“ als letztes Argument und ohne Anführungszeichen
const install = spawnSync(setup, ['/S', `/D=${target}`], { windowsVerbatimArguments: true, stdio: 'inherit' });
if (install.status !== 0 || !existsSync(exe)) throw new Error(`Installation gescheitert (${install.status})`);
mkdirSync(updates, { recursive: true });
copyFileSync(setup, update);
const installedAt = statSync(exe).mtimeMs;

const port = 9335;
const env = { ...process.env, BLATTWERK_USER_DATA: profile };
const child = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
const exited = new Promise((resolve) => child.once('exit', resolve));
let failed = false;
try {
  let browser;
  for (let i = 0; i < 120 && !browser; i++) {
    await sleep(250);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error('App nicht erreichbar');
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('Kein Fenster');
  const banner = page.getByTestId('update-banner');
  await banner.waitFor({ timeout: 30000 });
  const offered = (await banner.textContent())?.includes('99.0.0');
  console.log(`Update angeboten: ${offered ? 'ok' : 'FEHLER'}`);
  if (!offered) failed = true;
  await page.getByTestId('update-install').click().catch(() => undefined);

  // Die App beendet sich, das Installationsprogramm installiert still und startet sie neu
  await Promise.race([exited, sleep(30000)]);
  const reinstalled = () => existsSync(exe) && statSync(exe).mtimeMs > installedAt;
  for (let i = 0; i < 360 && !(reinstalled() && running()); i++) await sleep(500);
  const protocol = existsSync(log) ? readFileSync(log, 'utf8') : '(kein Protokoll)';
  console.log(`Protokoll:\n${protocol}`);
  const ok = protocol.includes('Starte Blattwerk-Setup-99.0.0.exe') && reinstalled() && running();
  console.log(`Update eingespielt: ${ok ? 'ok' : 'FEHLER'} (neu installiert: ${reinstalled()}, neu gestartet: ${running()})`);
  if (!ok) failed = true;
} finally {
  child.kill();
  try {
    execFileSync('taskkill', ['/F', '/T', '/IM', 'Blattwerk.exe'], { stdio: 'ignore' });
  } catch {
    // läuft nicht mehr
  }
  await sleep(1000);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) process.exitCode = 1;
