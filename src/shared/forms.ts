// Formularfelder (Phase 4): geänderte Werte ausgefüllter Felder. Gemeinsam für Oberfläche und PDFium-Worker.

// Neuer Wert eines Feldes, bezogen auf ein Widget (Objektnummer „12R“) auf einer Seite (0-basiert)
export type FormFieldValue =
  | { ref: string; pageIndex: number; kind: 'text'; text: string }
  | { ref: string; pageIndex: number; kind: 'checked'; checked: boolean }
  | { ref: string; pageIndex: number; kind: 'choice'; index: number };

// Was pdf.js über ein Widget weiß (getFieldObjects), soweit es für den Vergleich nötig ist
export interface WidgetInfo {
  id: string;
  page: number;
  type: string;
  value: unknown;
  exportValues?: string;
  items?: Array<{ exportValue: string; displayValue: string }>;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

// Vergleicht die Werte im Anmerkungsspeicher von pdf.js mit dem Stand der Datei und liefert die Änderungen.
// Unbekannte Schlüssel (z. B. eigene Einträge zum Ausblenden von Kommentaren) werden übergangen.
export function computeFormChanges(entries: Iterable<[string, unknown]>, widgets: Map<string, WidgetInfo>): FormFieldValue[] {
  const changes: FormFieldValue[] = [];
  for (const [id, stored] of entries) {
    const info = widgets.get(id);
    if (!info || info.page < 0 || typeof stored !== 'object' || stored === null || !('value' in stored)) continue;
    const value = (stored as { value: unknown }).value;
    const base = { ref: id, pageIndex: info.page };
    switch (info.type) {
      case 'text': {
        if (typeof value === 'string' && value !== asString(info.value)) changes.push({ ...base, kind: 'text', text: value });
        break;
      }
      case 'checkbox': {
        const wasChecked = asString(info.value) !== '' && asString(info.value) !== 'Off';
        if (typeof value === 'boolean' && value !== wasChecked) changes.push({ ...base, kind: 'checked', checked: value });
        break;
      }
      case 'radiobutton': {
        // Nur das Auswählen zählt; die übrigen Knöpfe der Gruppe gehen dabei von selbst aus.
        const wasChecked = info.exportValues !== undefined && asString(info.value) === info.exportValues;
        if (value === true && !wasChecked) changes.push({ ...base, kind: 'checked', checked: true });
        break;
      }
      case 'combobox':
      case 'listbox': {
        const selected = Array.isArray(value) ? value[0] : value;
        const before = Array.isArray(info.value) ? info.value[0] : info.value;
        if (typeof selected !== 'string' || selected === before) break;
        const index = (info.items ?? []).findIndex((item) => item.exportValue === selected);
        if (index >= 0) changes.push({ ...base, kind: 'choice', index });
        break;
      }
      default:
        break;
    }
  }
  return changes;
}
