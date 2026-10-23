// Schriften des Rechners für neuen Text (ADR 0024). Gemeinsam für Hauptprozess, Oberfläche und Worker.
// Neue Texte nutzen entweder eine Standardschrift (StampFont, nicht eingebettet) oder eine Schrift des Rechners
// (Kennung „sys:<familie>:<schnitt>“, wird eingebettet und kann alle ihre Zeichen darstellen).
import type { StampFont } from './stamping';

export type SystemFontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface SystemFont {
  id: string;
  name: string;
  styles: SystemFontStyle[];
}

export type SystemFontKey = `sys:${string}:${SystemFontStyle}`;
export type TextFont = StampFont | SystemFontKey;

const STYLES: SystemFontStyle[] = ['regular', 'bold', 'italic', 'boldItalic'];

export const systemFontKey = (id: string, style: SystemFontStyle): SystemFontKey => `sys:${id}:${style}`;

export function parseSystemFontKey(value: string): { id: string; style: SystemFontStyle } | null {
  const match = /^sys:([a-z0-9-]{1,40}):([a-zA-Z]+)$/.exec(value);
  if (!match || !STYLES.includes(match[2] as SystemFontStyle)) return null;
  return { id: match[1] as string, style: match[2] as SystemFontStyle };
}

export const isSystemFontKey = (value: string): value is SystemFontKey => parseSystemFontKey(value) !== null;

// Einbetten erlaubt? OS/2-Tabelle, fsType: Bit 1 (0x0002) = eingeschränkt, Bit 9 (0x0200) = nur Bitmaps
export function embeddingAllowed(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12) return false;
  const tables = view.getUint16(4);
  for (let i = 0; i < tables && 12 + i * 16 + 16 <= bytes.length; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
    if (tag !== 'OS/2') continue;
    const offset = view.getUint32(record + 8);
    if (offset + 10 > bytes.length) return false;
    const fsType = view.getUint16(offset + 8);
    // Nur die Bits 0–3 sind ein Zahlwert; 2 = eingeschränkt (kein Einbetten)
    return (fsType & 0x000f) !== 0x0002 && (fsType & 0x0200) === 0;
  }
  // Ohne OS/2-Tabelle: keine Einschränkung angegeben
  return true;
}


// Passende Schrift des Rechners für einen Schriftnamen aus einer PDF („Calibri,Bold“, „TimesNewRomanPS-BoldMT“,
// „ABCDEF+Arial-ItalicMT“) oder null. Schnitt aus dem Namen; fehlt er, der nächstliegende vorhandene.
export function systemFontFor(baseFont: string, fonts: readonly SystemFont[]): SystemFontKey | null {
  const name = baseFont.replace(/^[A-Z]{6}\+/, '');
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const familyPart = compact(name.split(/[,-]/)[0] ?? '').replace(/(psmt|mt|ps)$/, '');
  const whole = compact(name);
  const family =
    fonts.find((font) => compact(font.name) === familyPart) ??
    // Ohne Trennzeichen („CalibriBold“): längster passender Familienname am Anfang
    [...fonts].sort((a, b) => b.name.length - a.name.length).find((font) => whole.startsWith(compact(font.name)));
  if (!family) return null;
  const bold = /bold|black|heavy|semibold|demi/i.test(name);
  const italic = /italic|oblique|kursiv/i.test(name);
  const wanted: SystemFontStyle = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  const order: SystemFontStyle[] = [wanted, ...(wanted === 'boldItalic' ? (['bold', 'italic'] as const) : []), 'regular'];
  const style = order.find((candidate) => family.styles.includes(candidate));
  return style ? systemFontKey(family.id, style) : null;
}
