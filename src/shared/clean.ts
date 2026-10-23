// Dokument bereinigen (wie „Ausgeblendete Informationen entfernen“ in Acrobat): was entfernt werden soll
export interface CleanOptions {
  // Dokumentinformationen (Titel, Autor, Programm, Daten) und XMP-Metadaten
  metadata: boolean;
  // Eingebettete Dateien und Anhänge als Kommentar
  attachments: boolean;
  // JavaScript und automatische Aktionen (beim Öffnen, Schließen, Drucken, an Feldern und Seiten)
  scripts: boolean;
  // Lesezeichen
  bookmarks: boolean;
}

export const CLEAN_OPTIONS: ReadonlyArray<keyof CleanOptions> = ['metadata', 'attachments', 'scripts', 'bookmarks'];

// Was ein Dokument enthält (für den Dialog: nur Vorhandenes anbieten)
export type CleanFindings = Record<keyof CleanOptions, boolean>;
