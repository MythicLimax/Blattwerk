// Barrierefreiheit (Phase 7, ADR 0018): Tag-Struktur und Prüfergebnis. Gemeinsam für Oberfläche und Worker.

export interface TagNode {
  // Nummer in der Lesereihenfolge des Baums (gilt für einen Dokumentstand; zum Ändern einzelner Elemente)
  id: number;
  // Standardrolle nach /RoleMap (z. B. P, H1, Figure); bei eigenen Rollen ohne Zuordnung die eigene
  role: string;
  // Rolle im Dokument, wenn sie von der Standardrolle abweicht
  customRole: string | null;
  title: string | null;
  alt: string | null;
  actualText: string | null;
  lang: string | null;
  // 0-basierte Seite (aus /Pg des Elements oder seines ersten Inhalts)
  pageIndex: number | null;
  // Anzahl markierter Inhalte und Anmerkungen direkt unter dem Element
  contents: number;
  children: TagNode[];
}

export type AccessibilityCheckCode =
  | 'tagged'
  | 'language'
  | 'title'
  | 'display-title'
  | 'tab-order'
  | 'figure-alt'
  | 'heading-order'
  | 'table-headers'
  | 'field-tooltip'
  | 'image-only'
  | 'bookmarks'
  | 'annotations-tagged';

export interface AccessibilityCheck {
  code: AccessibilityCheckCode;
  // passed: erfüllt; failed: nicht erfüllt; skipped: nicht prüfbar (z. B. ohne Tags)
  status: 'passed' | 'failed' | 'skipped';
  // Anzahl betroffener Stellen (Abbildungen, Seiten …)
  count?: number;
  // Lässt sich mit „Beheben“ automatisch reparieren
  fixable?: boolean;
}

export interface AccessibilityReport {
  tagged: boolean;
  lang: string | null;
  title: string | null;
  checks: AccessibilityCheck[];
  tree: TagNode[];
  // Baum wegen Größe gekürzt
  truncated: boolean;
}

// Automatische Korrekturen: Sprache, Titel (in der Titelleiste anzeigen), Tab-Reihenfolge nach Struktur
export interface AccessibilityFix {
  lang: string | null;
  title: string | null;
  // Nur einzelne Elemente ändern (Seitenleiste „Tags“): Alternativtext bzw. Ersatztext setzen, leer = entfernen.
  // Dann bleiben Sprache, Titel und Tab-Reihenfolge unberührt.
  elements?: TagEdit[];
}

export interface TagEdit {
  id: number;
  alt?: string;
  actualText?: string;
}
