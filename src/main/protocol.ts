import { protocol } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_PROTOCOL } from '../shared/product';
import { CONTENT_SECURITY_POLICY, MIME_TYPES, resolveAppPath } from './protocol-paths';

// Der Renderer lädt alle App-Dateien über app://bundle/… statt über file://.
// So gilt 'self' in der CSP nur für die eigenen Dateien, und fetch() für WASM/CMaps funktioniert.

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

export function handleAppScheme(rootDir: string): void {
  protocol.handle(APP_PROTOCOL, async (request) => {
    const filePath = resolveAppPath(rootDir, request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    let body: Buffer;
    try {
      body = await fs.readFile(filePath);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers();
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
    if (mime) headers.set('Content-Type', mime);
    headers.set('X-Content-Type-Options', 'nosniff');
    // Für alle Antworten: Worker (z. B. pdf.js) bekommen ihre Richtlinie aus der eigenen Antwort,
    // nicht vom Dokument. Ohne diese Kopfzeile liefe der pdf.js-Worker ohne CSP.
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(new Uint8Array(body), { status: 200, headers });
  });
}
