import type { BlattwerkApi } from '../preload/api-types';

declare global {
  interface Window {
    blattwerk: BlattwerkApi;
  }
}

// Zugriff auf die Preload-Schnittstelle. Einzige Verbindung des Renderers zum Hauptprozess.
export const api: BlattwerkApi = window.blattwerk;
