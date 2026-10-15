// Zwei PDFs vergleichen (Phase 6, ADR 0014): Wörter mit Lage, Unterschiede je Seite. Gemeinsam für Oberfläche und Worker.
import type { Rect } from './annotations';

export interface PageWord {
  text: string;
  // Umgebendes Rechteck im PDF-Benutzerraum der Seite
  rect: Rect;
}

export interface WordDiff {
  // Indizes der entfernten Wörter in a und der neuen Wörter in b
  removed: number[];
  added: number[];
}

// Kleinste Menge an Änderungen (Myers, O((N+M)·D)). Bei sehr vielen Änderungen (D > maxD) gilt alles als geändert,
// damit Rechenzeit und Speicher begrenzt bleiben.
export function diffWords(a: string[], b: string[], maxD = 4000): WordDiff {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const offset = max + 1;
  const trace: Int32Array[] = [];
  let v: Int32Array = new Int32Array(2 * max + 3);
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number)) ? (v[offset + k + 1] as number) : (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return { removed: a.map((_, i) => i), added: b.map((_, i) => i) };
  // Rückwärts durch die gespeicherten Stände: welche Schritte waren Löschen bzw. Einfügen?
  const removed: number[] = [];
  const added: number[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    v = trace[d] as Int32Array;
    const k = x - y;
    const down = k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number));
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (down) added.push(y - 1);
    else removed.push(x - 1);
    x = prevX;
    y = prevY;
  }
  return { removed: removed.reverse(), added: added.reverse() };
}

// Wörter für den Vergleich: Satzzeichen am Rand und Groß-/Kleinschreibung zählen mit, Trennstriche am Zeilenende nicht
export const compareKey = (word: string) => word.normalize('NFC');

export interface CompareLabels {
  title: string;
  oldFile: string;
  newFile: string;
  summary: string;
  noChanges: string;
  page: string;
  noPage: string;
  pageLine: string;
  pagesAdded: string;
  pagesRemoved: string;
  legend: string;
}

export interface ComparePageResult {
  oldPage: number | null;
  newPage: number | null;
  removed: number;
  added: number;
  // Kurzer Ausschnitt der Änderung
  sample: string;
}
