// Gemeinsame i18n-Ressourcen für Hauptprozess und Renderer.
import de from './de/translation.json';

export const DEFAULT_LANGUAGE = 'de';

export const resources = {
  de: { translation: de },
} as const;

export type TranslationResource = typeof de;
