import { BrowserWindow, dialog, session, shell, type WebContents } from 'electron';
import { isAllowedExternalUrl } from '../shared/validate';
import { t } from './i18n';

// Erlaubte Herkunft für Seiten im Fenster (app://bundle oder in der Entwicklung der Vite-Server).
export function isTrustedAppUrl(url: string, devServerOrigin: string | null): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'app:' && parsed.host === 'bundle') return true;
    return devServerOrigin !== null && parsed.origin === devServerOrigin;
  } catch {
    return false;
  }
}

// Fragt nach und öffnet den Link dann im Standardbrowser bzw. Mailprogramm.
export async function confirmAndOpenExternal(url: string, parent: BrowserWindow | null): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) return false;
  const options = {
    type: 'question' as const,
    buttons: [t('dialog.externalLink.open'), t('dialog.externalLink.cancel')],
    defaultId: 0,
    cancelId: 1,
    message: t('dialog.externalLink.message'),
    detail: t('dialog.externalLink.detail', { url }),
    noLink: true,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return false;
  await shell.openExternal(url);
  return true;
}

export function hardenWebContents(contents: WebContents, devServerOrigin: string | null): void {
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url, devServerOrigin)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedAppUrl(url, devServerOrigin)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Links aus PDFs (target=_blank) landen hier: nie ein neues Fenster, höchstens nach Rückfrage im Browser.
  contents.setWindowOpenHandler(({ url }) => {
    void confirmAndOpenExternal(url, BrowserWindow.fromWebContents(contents));
    return { action: 'deny' };
  });
}

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

export function hardenSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  // Keine Downloads, die der Renderer selbst anstößt.
  ses.on('will-download', (event) => event.preventDefault());
}
