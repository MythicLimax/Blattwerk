// Einzige Quelle für Produktname und App-ID im Code.
// electron-builder.yml und package.json müssen dieselben Werte tragen (Test prüft das).
export const PRODUCT_NAME = 'Blattwerk';
export const APP_ID = 'de.blattwerk.app';

// Eigenes Protokoll, über das der Renderer die App-Dateien lädt.
export const APP_PROTOCOL = 'app';
export const APP_HOST = 'bundle';
export const APP_ORIGIN = `${APP_PROTOCOL}://${APP_HOST}`;
