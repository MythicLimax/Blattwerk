// Updates ohne Internet (ADR 0025): Versionsvergleich, Info.plist lesen, Hilfsskript tauscht die App sicher aus.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTALL_SCRIPT, windowsInstallCommand } from '../../src/main/update/install-script';
import { compareVersions, plistString } from '../../src/shared/update';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fakeApp(dir: string, name: string, version: string): string {
  const bundle = path.join(dir, name);
  mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), `<plist><dict><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`);
  writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'Blattwerk'), `Version ${version}`);
  return bundle;
}

describe('Updates', () => {
  it('vergleicht Versionsnummern', () => {
    expect(compareVersions('0.9.10', '0.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.99')).toBe(1);
    expect(compareVersions('0.9.9', '0.9.9')).toBe(0);
    expect(compareVersions('0.9.8', '0.9.9')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('baut den Windows-Befehl mit sicher eingesetzten Pfaden', () => {
    const command = windowsInstallCommand(1234, "C:\\Users\\Max O'Brien\\Blattwerk-Setup-1.0.0.exe", true, false);
    expect(command).toContain("$installer = 'C:\\Users\\Max O''Brien\\Blattwerk-Setup-1.0.0.exe'");
    expect(command).toContain("$appPid = 1234");
    expect(command).toContain("'--force-run'");
    expect(command).not.toContain('Remove-Item');
    expect(windowsInstallCommand(1, 'x.exe', false, true)).toContain('Remove-Item');
  });

  it('liest Werte aus der Info.plist', () => {
    const xml = '<dict><key>CFBundleIdentifier</key>\n\t<string>de.blattwerk.app</string><key>CFBundleShortVersionString</key><string>0.9.9</string></dict>';
    expect(plistString(xml, 'CFBundleIdentifier')).toBe('de.blattwerk.app');
    expect(plistString(xml, 'CFBundleShortVersionString')).toBe('0.9.9');
    expect(plistString(xml, 'Fehlt')).toBeNull();
  });

  it.skipIf(process.platform !== 'darwin')('Hilfsskript tauscht die App aus und räumt auf', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-update-'));
    dirs.push(dir);
    const current = fakeApp(dir, 'Blattwerk.app', '0.9.9');
    const updates = path.join(dir, 'Updates');
    mkdirSync(updates);
    const next = fakeApp(updates, 'Blattwerk.app', '0.9.10');
    // Prozess, der schon beendet ist: das Skript wartet nicht
    const result = spawnSync('/bin/sh', ['-c', INSTALL_SCRIPT, 'test', '2147483646', next, current, 'no', 'cleanup'], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(current, 'Contents', 'MacOS', 'Blattwerk'), 'utf8')).toBe('Version 0.9.10');
    expect(existsSync(next)).toBe(false);
    expect(readdirSync(dir).sort()).toEqual(['Blattwerk.app', 'Updates']);
  });

  it.skipIf(process.platform !== 'darwin')('lässt die alte App stehen, wenn das Update fehlt', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-update-'));
    dirs.push(dir);
    const current = fakeApp(dir, 'Blattwerk.app', '0.9.9');
    const result = spawnSync('/bin/sh', ['-c', INSTALL_SCRIPT, 'test', '2147483646', path.join(dir, 'fehlt.app'), current, 'no', 'cleanup'], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status).not.toBe(0);
    expect(readFileSync(path.join(current, 'Contents', 'MacOS', 'Blattwerk'), 'utf8')).toBe('Version 0.9.9');
    expect(readdirSync(dir)).toEqual(['Blattwerk.app']);
  });
});
