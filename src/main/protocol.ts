import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
    let response: Response;
    try {
      response = await net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!response.ok) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
    if (mime) headers.set('Content-Type', mime);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.html')) {
      headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    }
    return new Response(response.body, { status: 200, headers });
  });
}
