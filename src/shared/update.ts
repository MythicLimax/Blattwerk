// Updates ohne Internet (ADR 0025): Stand der App und eines bereitliegenden Updates. Gemeinsam für Haupt- und Renderer.

export type UpdateStatus =
  | { state: 'available'; current: string; version: string }
  | { state: 'current'; current: string }
  // Updates gehen hier nicht (Entwicklung, Windows, App läuft vom Disk-Image oder aus einem schreibgeschützten Ordner)
  | { state: 'unsupported'; current: string; reason: 'development' | 'platform' | 'location' };

// Versionsnummern vergleichen (1.2.10 > 1.2.9); Zusätze nach „-“ zählen nicht
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split('-')[0]!.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// Wert eines Schlüssels aus einer XML-Info.plist (nur Zeichenketten)
export function plistString(xml: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return match ? (match[1] as string) : null;
}
