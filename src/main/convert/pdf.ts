// HTML → PDF mit Chromium (printToPDF) in einem unsichtbaren Fenster: eigene Sitzung ohne Netz, ohne JavaScript, ohne
// Zugriff auf die App. Die Seite liegt als temporäre Datei vor (data:-URLs sind in der Länge begrenzt).
import { BrowserWindow, session } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PARTITION = 'blattwerk-convert';
let configured = false;

function convertSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION, { cache: false });
  if (!configured) {
    configured = true;
    // Nur die eine Datei und eingebettete Bilder; alles andere (Netz, andere Dateien) gesperrt
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('data:') || (details.url.startsWith('file:') && /\/blattwerk-convert-[^/]+\/document\.html$/.test(details.url));
      callback({ cancel: !allowed });
    });
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  }
  return ses;
}

export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), 'blattwerk-convert-'));
  const file = path.join(dir, 'document.html');
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1100,
    webPreferences: {
      session: convertSession(),
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      images: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  try {
    await writeFile(file, html, 'utf8');
    await win.loadURL(pathToFileURL(file).href);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
      displayHeaderFooter: false,
    });
    return new Uint8Array(data);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    await rm(dir, { recursive: true, force: true });
  }
}
