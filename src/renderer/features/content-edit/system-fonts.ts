// Schriften des Rechners in der Oberfläche (ADR 0024): Liste einmal laden, Schriftdaten bei Bedarf holen und
// zwischenspeichern, als FontFace anmelden (Vorschau in der Eingabe, auch für Office-Schriften, die macOS nicht kennt).
import { create } from 'zustand';
import type { ContentOperation } from '../../../shared/content';
import { isSystemFontKey, parseSystemFontKey, type SystemFont, type TextFont } from '../../../shared/fonts';
import { api } from '../../api';

interface SystemFontsState {
  fonts: SystemFont[];
  loaded: boolean;
  load: () => void;
}

export const useSystemFonts = create<SystemFontsState>((set, get) => ({
  fonts: [],
  loaded: false,
  load: () => {
    if (get().loaded) return;
    set({ loaded: true });
    void api.fonts
      .list()
      .then((fonts) => set({ fonts }))
      .catch(() => set({ fonts: [] }));
  },
}));

const data = new Map<string, Promise<Uint8Array | null>>();

export function systemFontData(key: string): Promise<Uint8Array | null> {
  let pending = data.get(key);
  if (!pending) {
    pending = api.fonts.read(key).catch(() => null);
    data.set(key, pending);
  }
  return pending;
}

// CSS-Name der angemeldeten Schrift für die Vorschau
export const previewFamily = (key: string) => `Blattwerk ${key}`;

const registered = new Set<string>();

export async function registerPreview(key: string): Promise<void> {
  if (registered.has(key) || !isSystemFontKey(key)) return;
  registered.add(key);
  const bytes = await systemFontData(key);
  if (!bytes) return;
  const face = new FontFace(previewFamily(key), bytes.slice().buffer as ArrayBuffer);
  await face.load();
  document.fonts.add(face);
}

// Schriftdaten an Operationen mit Schriften des Rechners hängen (der Worker bettet sie ein)
export async function withFontData(operation: ContentOperation): Promise<ContentOperation> {
  const fetch = async (font: TextFont | undefined) => (font && isSystemFontKey(font) ? await systemFontData(font) : null);
  if (operation.type === 'addText') {
    const bytes = await fetch(operation.font);
    return bytes ? { ...operation, fontData: bytes.slice().buffer as ArrayBuffer } : operation;
  }
  if (operation.type === 'editParagraph' && operation.style?.font) {
    const bytes = await fetch(operation.style.font);
    return bytes ? { ...operation, style: { ...operation.style, fontData: bytes.slice().buffer as ArrayBuffer } } : operation;
  }
  return operation;
}

// Anzeigename „Arial Fett Kursiv“ aus Familie und Schnitt
export function fontLabel(key: string, fonts: SystemFont[], styleNames: Record<string, string>): string {
  const parsed = parseSystemFontKey(key);
  const family = parsed ? fonts.find((font) => font.id === parsed.id) : undefined;
  if (!parsed || !family) return key;
  return parsed.style === 'regular' ? family.name : `${family.name} ${styleNames[parsed.style] ?? ''}`.trim();
}
