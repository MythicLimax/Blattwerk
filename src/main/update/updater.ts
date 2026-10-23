// Updates ohne Internet (ADR 0025), für macOS und Windows. Neue Versionen liegen in einem Update-Ordner: dem Ordner
// „Updates“ im Profil der App und, falls gewählt, einem eigenen Ordner (z. B. in iCloud Drive oder OneDrive, damit
// mehrere Rechner dieselben Updates sehen).
//   macOS:   die fertige App „Blattwerk.app“ (gleiche App-ID, gültige Signatur)
//   Windows: das Installationsprogramm „Blattwerk-Setup-<Version>.exe“
// Die App prüft beim Start und wenn ihr Fenster nach vorn kommt. „Jetzt aktualisieren“ schließt die App über den
// normalen Weg (Rückfrage bei ungespeicherten Änderungen); danach tauscht ein Hilfsskript die App aus (macOS) bzw.
// läuft das Installationsprogramm still (Windows, Protokoll in „update.log“ im Update-Ordner), und die App öffnet
// sich neu.
import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { APP_ID, PRODUCT_NAME } from '../../shared/product';
import { compareVersions, plistString, type UpdateStatus } from '../../shared/update';
import { INSTALL_SCRIPT, windowsInstallCommand } from './install-script';

export const UPDATE_APP_NAME = `${PRODUCT_NAME}.app`;
const INSTALLER_PATTERN = new RegExp(`^${PRODUCT_NAME}-Setup-(\\d+(?:\\.\\d+){1,3})\\.exe$`, 'i');

let customFolder: () => string | null = () => null;

// Eigener Update-Ordner aus den Einstellungen (wird beim Start verbunden)
export function setCustomUpdateFolder(read: () => string | null): void {
  customFolder = read;
}

export const defaultUpdateFolder = (): string => path.join(app.getPath('userData'), 'Updates');

function updateFolders(): string[] {
  const custom = customFolder();
  return [defaultUpdateFolder(), ...(custom && custom !== defaultUpdateFolder() ? [custom] : [])];
}

// Laufende App unter macOS: …/Blattwerk.app/Contents/MacOS/Blattwerk
export function runningBundle(): string | null {
  const bundle = path.resolve(path.dirname(process.execPath), '..', '..');
  return bundle.endsWith('.app') ? bundle : null;
}

export function bundleInfo(bundle: string): { id: string; version: string } | null {
  try {
    const xml = readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8');
    const id = plistString(xml, 'CFBundleIdentifier');
    const version = plistString(xml, 'CFBundleShortVersionString');
    return id && version ? { id, version } : null;
  } catch {
    return null;
  }
}

// Signatur unversehrt (auch die lokale Ad-hoc-Signatur schützt vor halb kopierten oder veränderten Dateien)
function signatureValid(bundle: string): boolean {
  const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'ignore', timeout: 60_000 });
  return result.status === 0;
}

// Windows-Programm: beginnt mit „MZ“ und ist nicht winzig (halb kopierte Dateien aus Cloud-Ordnern)
function looksLikeInstaller(file: string): boolean {
  try {
    if (statSync(file).size < 1024 * 1024) return false;
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(2);
      readSync(fd, head, 0, 2, 0);
      return head.toString('latin1') === 'MZ';
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

interface Candidate {
  path: string;
  version: string;
}

function macCandidate(): Candidate | null {
  let best: Candidate | null = null;
  for (const folder of updateFolders()) {
    const bundle = path.join(folder, UPDATE_APP_NAME);
    const info = existsSync(bundle) ? bundleInfo(bundle) : null;
    if (info?.id === APP_ID && (!best || compareVersions(info.version, best.version) > 0)) best = { path: bundle, version: info.version };
  }
  return best;
}

function windowsCandidate(): Candidate | null {
  let best: Candidate | null = null;
  for (const folder of updateFolders()) {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      const version = INSTALLER_PATTERN.exec(name)?.[1];
      if (version && (!best || compareVersions(version, best.version) > 0)) best = { path: path.join(folder, name), version };
    }
  }
  return best;
}

let verified: Candidate | null = null;

function verify(candidate: Candidate): boolean {
  if (verified?.path === candidate.path && verified.version === candidate.version) return true;
  const ok = process.platform === 'darwin' ? signatureValid(candidate.path) : looksLikeInstaller(candidate.path);
  if (ok) verified = candidate;
  return ok;
}

function findUpdate(): { status: UpdateStatus; candidate: Candidate | null } {
  const current = app.getVersion();
  if (!app.isPackaged) return { status: { state: 'unsupported', current, reason: 'development' }, candidate: null };
  if (process.platform === 'darwin') {
    const bundle = runningBundle();
    if (!bundle || bundle.startsWith('/Volumes/')) return { status: { state: 'unsupported', current, reason: 'location' }, candidate: null };
    try {
      accessSync(path.dirname(bundle), constants.W_OK);
    } catch {
      return { status: { state: 'unsupported', current, reason: 'location' }, candidate: null };
    }
  } else if (process.platform !== 'win32') {
    return { status: { state: 'unsupported', current, reason: 'platform' }, candidate: null };
  }
  const candidate = process.platform === 'darwin' ? macCandidate() : windowsCandidate();
  if (!candidate || compareVersions(candidate.version, current) <= 0 || !verify(candidate)) return { status: { state: 'current', current }, candidate: null };
  return { status: { state: 'available', current, version: candidate.version }, candidate };
}

export function checkForUpdate(): UpdateStatus {
  return findUpdate().status;
}

let pending: Candidate | null = null;

// Update für das Beenden vormerken; true, wenn eines bereitliegt
export function scheduleInstall(): boolean {
  const { candidate } = findUpdate();
  pending = candidate;
  return candidate !== null;
}

// Beim Beenden: Hilfsskript losgelöst starten (läuft weiter, wenn die App sich beendet). Unsichtbare Läufe (Rauchtest)
// öffnen die App danach nicht neu.
export function runPendingInstall(): void {
  if (!pending) return;
  const reopen = process.env.BLATTWERK_HIDDEN !== '1';
  // Nur Updates aus dem eigenen Profil löschen; ein geteilter Ordner versorgt auch andere Rechner
  const cleanup = path.dirname(pending.path) === defaultUpdateFolder();
  if (process.platform === 'darwin') {
    const bundle = runningBundle();
    if (!bundle) return;
    spawn('/bin/sh', ['-c', INSTALL_SCRIPT, 'blattwerk-update', String(process.pid), pending.path, bundle, reopen ? 'open' : 'no', cleanup ? 'cleanup' : 'keep'], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (process.platform === 'win32') {
    // Voller Pfad: PowerShell liegt immer dort, ein veränderter Suchpfad (PATH) spielt keine Rolle
    spawn(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', windowsInstallCommand({ pid: process.pid, installer: pending.path, app: process.execPath, log: path.join(defaultUpdateFolder(), 'update.log'), reopen, cleanup })],
      { detached: true, stdio: 'ignore', windowsHide: true },
    ).unref();
  }
  pending = null;
}
