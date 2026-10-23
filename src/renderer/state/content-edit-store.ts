// Modus „Inhalt bearbeiten“ (Phase 5): Werkzeug, Auswahl, Texteingabe auf der Seite, Stil für neuen Text.
// Die Objekte selbst stehen im Dokument; jede Änderung ergibt einen neuen Dokumentstand (history-store).
import { create } from 'zustand';
import type { Point, Rect, Rgb } from '../../shared/annotations';
import type { EditUnit, ParagraphStyle } from '../../shared/content';
import type { TextFont } from '../../shared/fonts';
import type { RunStyle, TextRun } from '../../shared/rich-text';

// flow: Fließtext über die ganze Breite zwischen den Seitenrändern, wie in einer Textverarbeitung
export type ContentTool = 'select' | 'text' | 'flow';

export interface SelectedObject {
  pageIndex: number;
  index: number;
  // alle Objekte der Einheit (bei Text: alle Stücke der Zeile), einschließlich index
  members: number[];
  // die Einheit selbst (Text, Lage, Gestaltung), für Größe, Schrift und Farbe in der Leiste
  unit?: EditUnit;
  // Mehrfachauswahl: alle ausgewählten Einheiten der Seite (mindestens zwei, einschließlich index)
  group?: Array<{ index: number; members: number[] }>;
}

// Texteingabe direkt auf der Seite: neue Zeilen an einer Stelle (at = Klickstelle, Anfang und Mitte der ersten Zeile,
// in Ansichtskoordinaten) oder eine vorhandene Zeile ändern. runs, origin, width: von Blattwerk gesetzter Text, der
// mit gemischter Gestaltung bearbeitet wird (Stücke, Anfang und Oberkante der ersten Zeile, Breite)
export type TextEditing =
  | { tabId: string; pageIndex: number; mode: 'new'; at: Point; flow?: boolean }
  | {
      tabId: string;
      pageIndex: number;
      mode: 'edit';
      index: number;
      merge: number[];
      bounds: Rect;
      text: string;
      fontSize: number;
      font?: string;
      lines?: number[][];
      color?: Rgb;
      style?: ParagraphStyle;
      runs?: TextRun[];
      origin?: Point;
      width?: number;
    };

export interface TextStyle {
  font: TextFont;
  size: number;
  color: Rgb;
}

export interface MarqueeRequest {
  tabId: string;
  pageIndex: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  additive: boolean;
}

interface ContentEditState {
  tool: ContentTool;
  selected: Record<string, SelectedObject | null>;
  editing: TextEditing | null;
  style: TextStyle;
  // Gestaltung an der Einfügestelle der offenen Eingabe (für die Anzeige in der Leiste)
  caret: RunStyle | null;
  setCaret: (caret: RunStyle | null) => void;
  // Lage eines Objekts, die gerade übernommen wird (bis zum Neuladen)
  // Neue Lage von Objekten, die gerade übernommen wird (bis zum Neuladen), je Index
  pending: Record<string, { pageIndex: number; bounds: Record<number, Rect> } | null>;
  // Nach dem Neusetzen eines Textes: den Text an dieser Stelle wieder auswählen (Positionen ändern sich dabei)
  reselect: { tabId: string; pageIndex: number; at: Point } | null;
  setReselect: (reselect: { tabId: string; pageIndex: number; at: Point } | null) => void;
  // Auswahlrahmen, der neben der Seite begann: Fensterkoordinaten; die Seite mit der größten Überdeckung wählt aus
  marquee: MarqueeRequest | null;
  setMarquee: (marquee: MarqueeRequest | null) => void;
  setTool: (tool: ContentTool) => void;
  select: (tabId: string, selected: SelectedObject | null) => void;
  setEditing: (editing: TextEditing | null) => void;
  setStyle: (patch: Partial<TextStyle>) => void;
  setPending: (tabId: string, pending: { pageIndex: number; bounds: Record<number, Rect> } | null) => void;
  drop: (tabId: string) => void;
}

export const useContentEdit = create<ContentEditState>((set) => ({
  tool: 'select',
  selected: {},
  editing: null,
  style: { font: 'Helvetica', size: 12, color: { r: 0, g: 0, b: 0 } },
  pending: {},
  reselect: null,
  marquee: null,
  caret: null,
  setCaret: (caret) => set({ caret }),
  setReselect: (reselect) => set({ reselect }),
  setMarquee: (marquee) => set({ marquee }),
  setTool: (tool) => set({ tool }),
  select: (tabId, selected) => set((state) => ({ selected: { ...state.selected, [tabId]: selected } })),
  setEditing: (editing) => set({ editing }),
  setStyle: (patch) => set((state) => ({ style: { ...state.style, ...patch } })),
  setPending: (tabId, pending) => set((state) => ({ pending: { ...state.pending, [tabId]: pending } })),
  drop: (tabId) =>
    set((state) => {
      const selected = { ...state.selected };
      const pending = { ...state.pending };
      delete selected[tabId];
      delete pending[tabId];
      return { selected, pending, editing: state.editing?.tabId === tabId ? null : state.editing };
    }),
}));
