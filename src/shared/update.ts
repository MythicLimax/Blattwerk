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

// Suche im Netz (ADR 0027): Ergebnis von „Nach Updates suchen“
export type OnlineCheck =
  // Neue Version liegt jetzt im Update-Ordner (oder lag schon dort); danach zeigt der Status sie als 'available'
  | { state: 'downloaded'; version: string }
  | { state: 'current'; current: string }
  | { state: 'unsupported'; current: string; reason: 'development' | 'platform' | 'location' }
  | { state: 'failed'; reason: 'offline' | 'no-release' | 'download' | 'invalid' };

// Fortschritt beim Laden einer neuen Version
export interface UpdateProgress {
  version: string;
  received: number;
  total: number | null;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface Release {
  version: string;
  assets: ReleaseAsset[];
}

// Antwort von GET /repos/{repo}/releases/latest: Version aus dem Tag (v1.2.3), Dateien mit Adresse und Größe
export function parseRelease(json: unknown): Release | null {
  if (typeof json !== 'object' || json === null) return null;
  const data = json as { tag_name?: unknown; assets?: unknown; draft?: unknown; prerelease?: unknown };
  if (typeof data.tag_name !== 'string' || data.draft === true || data.prerelease === true) return null;
  const version = /^v?(\d+(?:\.\d+){1,3})$/.exec(data.tag_name.trim())?.[1];
  if (!version || !Array.isArray(data.assets)) return null;
  const assets: ReleaseAsset[] = [];
  for (const raw of data.assets as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const asset = raw as { name?: unknown; browser_download_url?: unknown; size?: unknown };
    if (typeof asset.name === 'string' && typeof asset.browser_download_url === 'string' && typeof asset.size === 'number') {
      assets.push({ name: asset.name, url: asset.browser_download_url, size: asset.size });
    }
  }
  return { version, assets };
}

// Datei für dieses System: macOS die gepackte App passend zum Prozessor, Windows das Installationsprogramm
export function updateAssetName(product: string, version: string, platform: string, arch: string): string | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `${product}-${version}-${arch}-mac.zip`;
  if (platform === 'win32') return `${product}-Setup-${version}.exe`;
  return null;
}

// Nur über HTTPS und nur von GitHub (auch nach Weiterleitungen auf den Speicher für Release-Dateien)
const UPDATE_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

export function isAllowedUpdateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && UPDATE_HOSTS.has(parsed.hostname) && !parsed.username && !parsed.password && (parsed.port === '' || parsed.port === '443');
  } catch {
    return false;
  }
}
