import { app, dialog, shell, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import type { DefaultAppResult } from '../shared/ipc';
import { APP_ID } from '../shared/product';
import { t } from './i18n';

// Systemweiter Typbezeichner (UTI) für PDF-Dateien unter macOS.
const PDF_UTI = 'com.adobe.pdf';

// Setzt die App unter macOS über Launch Services als Standard für PDFs.
// Electron bietet dafür keine Schnittstelle; JavaScript for Automation kann die C-Funktion direkt aufrufen.
// Funktioniert nur in der installierten App, weil nur sie unter der eigenen Bundle-ID registriert ist.
function setDefaultOnMac(): Promise<boolean> {
  const script = [
    "ObjC.import('CoreServices');",
    `$.LSSetDefaultRoleHandlerForContentType($('${PDF_UTI}'), $.kLSRolesAll, $('${APP_ID}'));`,
  ].join(' ');
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { timeout: 5000 }, (error, stdout) => {
      resolve(!error && stdout.trim() === '0');
    });
  });
}

async function showInfo(parent: BrowserWindow | null, message: string, detail?: string): Promise<void> {
  const options = { type: 'info' as const, message, detail, buttons: [t('dialog.defaultApp.ok')] };
  if (parent) await dialog.showMessageBox(parent, options);
  else await dialog.showMessageBox(options);
}

// Windows erlaubt Apps nicht, sich selbst als Standard einzutragen; wir öffnen die passende Einstellungsseite.
export async function setAsDefaultPdfApp(
  parent: BrowserWindow | null,
  platform: NodeJS.Platform = process.platform,
): Promise<DefaultAppResult> {
  if (platform === 'win32') {
    await shell.openExternal('ms-settings:defaultapps');
    await showInfo(parent, t('dialog.defaultApp.winMessage'));
    return 'opened-settings';
  }
  if (platform === 'darwin' && app.isPackaged && (await setDefaultOnMac())) {
    await showInfo(parent, t('dialog.defaultApp.macSuccess'));
    return 'already-default';
  }
  await showInfo(parent, t('dialog.defaultApp.macMessage'), t('dialog.defaultApp.macDetail'));
  return 'show-instructions';
}
