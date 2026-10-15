// Texterkennung (Phase 6, ADR 0015): erkannte Wörter mit Lage im gezeichneten Seitenbild. Gemeinsam für Oberfläche
// und Worker.
import { isWinAnsi } from './content';

export interface OcrWord {
  text: string;
  // Umgebendes Rechteck im Bild (Bildpunkte, Ursprung oben links)
  box: [number, number, number, number];
  // Grundlinie unter dem Wort und Schriftgröße (Bildpunkte)
  baseline: number;
  size: number;
}

// Ausschnitt der Ergebnisse von tesseract.js (nur, was gebraucht wird)
export interface OcrLine {
  baseline: { x0: number; y0: number; x1: number; y1: number };
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
}

export interface OcrBlock {
  paragraphs: Array<{ lines: OcrLine[] }>;
}

// Wörter unter dieser Sicherheit (0–100) sind meist Flecken oder Ränder
export const MIN_CONFIDENCE = 30;

// Seiten mit so vielen Zeichen haben schon Text und werden übersprungen
export const TEXT_PAGE_MIN_CHARS = 20;

export function hasTextLayer(text: string): boolean {
  return text.replace(/\s/g, '').length >= TEXT_PAGE_MIN_CHARS;
}

// Die unsichtbare Textebene nutzt eine Standardschrift (westeuropäischer Zeichensatz): Ligaturen auflösen, Unbekanntes
// weglassen
const LIGATURES: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

export function ocrText(text: string): string {
  return [...text.normalize('NFC')]
    .map((char) => LIGATURES[char] ?? char)
    .join('')
    .split('')
    .filter((char) => isWinAnsi(char))
    .join('')
    .trim();
}

export function wordsFromBlocks(blocks: OcrBlock[] | null): OcrWord[] {
  const words: OcrWord[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const { baseline, bbox } = line;
        const slope = baseline.x1 !== baseline.x0 ? (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0) : 0;
        for (const word of line.words) {
          const text = ocrText(word.text);
          if (!text || word.confidence < MIN_CONFIDENCE) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          if (x1 <= x0 || y1 <= y0) continue;
          // Grundlinie an der Wortmitte; Schriftgröße aus dem Abstand zur Oberkante der Zeile (Oberlänge etwa 0,75 em)
          const at = baseline.y0 + slope * ((x0 + x1) / 2 - baseline.x0);
          const base = Math.min(Math.max(at, y0 + 1), y1 + (y1 - y0));
          const size = Math.max(4, (base - Math.min(bbox.y0, y0)) / 0.75);
          words.push({ text, box: [x0, y0, x1, y1], baseline: base, size });
        }
      }
    }
  }
  return words;
}

// Graustufenbild im PGM-Format (P5) aus RGBA-Bildpunkten: liest die Erkennung ohne weitere Kodierung
export function rgbaToPgm(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + width * height);
  out.set(header, 0);
  for (let i = 0, o = header.length; i < width * height; i++, o++) {
    const p = i * 4;
    out[o] = ((rgba[p] as number) * 299 + (rgba[p + 1] as number) * 587 + (rgba[p + 2] as number) * 114) / 1000;
  }
  return out;
}
