// Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen (Phase 5). Gemeinsam für Oberfläche und Worker.
// Alle Maße in Punkt, bezogen auf die Seite, wie sie angezeigt wird (gedrehte Seiten aufrecht).
import type { Rgb } from './annotations';
import type { ImageSource } from './pages';

// Standardschriften (ohne Einbetten; Zeichensatz Westeuropa)
export const STAMP_FONTS = ['Helvetica', 'HelveticaBold', 'TimesRoman', 'TimesRomanBold', 'Courier'] as const;
export type StampFont = (typeof STAMP_FONTS)[number];

export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type HorizontalAlign = 'left' | 'center' | 'right';

interface WatermarkCommon {
  // 0 bis 1
  opacity: number;
  // Grad gegen den Uhrzeigersinn
  rotation: number;
  vertical: VerticalAlign;
  horizontal: HorizontalAlign;
  // hinter dem Seiteninhalt (sonst darüber)
  behind: boolean;
  // Seiten (0-basiert); null = alle
  pages: number[] | null;
}

export type WatermarkSpec =
  | (WatermarkCommon & {
      kind: 'text';
      text: string;
      font: StampFont;
      // Schriftgröße in Punkt; 0 = passend zur Seite
      size: number;
      color: Rgb;
    })
  | (WatermarkCommon & {
      kind: 'image';
      image: ImageSource;
      // Breite des Bildes in Prozent der Seitenbreite
      scale: number;
    });

// Sechs Felder wie in Acrobat; Platzhalter siehe STAMP_TOKENS
export interface HeaderFooterTexts {
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerCenter: string;
  footerRight: string;
}

export interface HeaderFooterSpec {
  texts: HeaderFooterTexts;
  font: StampFont;
  size: number;
  color: Rgb;
  // Abstand vom Seitenrand in Punkt
  margins: { top: number; bottom: number; left: number; right: number };
  // Nummer der ersten Seite des Bereichs (z. B. 3, wenn das Deckblatt nicht mitzählt)
  startNumber: number;
  pages: number[] | null;
  // Werte für {Datum} und {Datei}, von der Oberfläche festgelegt
  date: string;
  fileName: string;
}

export type ArtifactKind = 'watermark' | 'headerFooter';

export type StampOperation =
  // replace: vorhandene Wasserzeichen dieses Programms vorher entfernen
  | { type: 'addWatermark'; spec: WatermarkSpec; replace: boolean }
  | { type: 'addHeaderFooter'; spec: HeaderFooterSpec; replace: boolean }
  | { type: 'removeArtifacts'; kind: ArtifactKind };

// Platzhalter in Kopf- und Fußzeilen
export const STAMP_TOKENS = {
  page: '{Seite}',
  pages: '{Seiten}',
  date: '{Datum}',
  file: '{Datei}',
} as const;

export function expandTokens(text: string, values: { page: number; pages: number; date: string; file: string }): string {
  return text
    .split(STAMP_TOKENS.page)
    .join(String(values.page))
    .split(STAMP_TOKENS.pages)
    .join(String(values.pages))
    .split(STAMP_TOKENS.date)
    .join(values.date)
    .split(STAMP_TOKENS.file)
    .join(values.file);
}

export const EMPTY_TEXTS: HeaderFooterTexts = {
  headerLeft: '',
  headerCenter: '',
  headerRight: '',
  footerLeft: '',
  footerCenter: '',
  footerRight: '',
};

// Seitenzahlen sind eine Kopf- oder Fußzeile mit einem einzigen Feld
export type PageNumberPosition = keyof HeaderFooterTexts;
export const PAGE_NUMBER_FORMATS = ['plain', 'page', 'pageOf', 'slash'] as const;
export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number];

export function pageNumberText(format: PageNumberFormat, labels: { page: string; of: string }): string {
  switch (format) {
    case 'plain':
      return STAMP_TOKENS.page;
    case 'page':
      return `${labels.page} ${STAMP_TOKENS.page}`;
    case 'pageOf':
      return `${labels.page} ${STAMP_TOKENS.page} ${labels.of} ${STAMP_TOKENS.pages}`;
    case 'slash':
      return `${STAMP_TOKENS.page} / ${STAMP_TOKENS.pages}`;
  }
}

// Umrechnung von der angezeigten Seite (Ursprung unten links, aufrecht) in den PDF-Benutzerraum der Seite.
// box: sichtbarer Bereich (CropBox) im Benutzerraum, rotation: /Rotate der Seite (0, 90, 180, 270).
// Ergebnis als Matrix [a b c d e f] (x' = a·x + c·y + e, y' = b·x + d·y + f) und Größe der angezeigten Seite.
export function visualToUser(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
): { matrix: [number, number, number, number, number, number]; width: number; height: number } {
  const { x, y, width: w, height: h } = box;
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { matrix: [0, 1, -1, 0, x + w, y], width: h, height: w };
    case 180:
      return { matrix: [-1, 0, 0, -1, x + w, y + h], width: w, height: h };
    case 270:
      return { matrix: [0, -1, 1, 0, x, y + h], width: h, height: w };
    default:
      return { matrix: [1, 0, 0, 1, x, y], width: w, height: h };
  }
}
