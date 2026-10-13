// Formularfelder (Phase 4): geänderte Werte ausgefüllter Felder sowie Felder anlegen und bearbeiten.
// Gemeinsam für Oberfläche und Worker.
import type { Rect } from './annotations';

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

// ---------------------------------------------------------------------------------------------------------------
// Formularfelder anlegen und bearbeiten (Phase 4, „Formular bearbeiten“)

export type FieldKind = 'text' | 'checkbox' | 'radio' | 'dropdown' | 'list';

// Eigenschaften eines Feldes, wie sie der Eigenschaften-Dialog zeigt
export interface FieldSettings {
  // Feldname (bei Optionsfeldern: Name der Gruppe). Ohne Punkt, weil der Punkt Feldhierarchien trennt.
  name: string;
  // QuickInfo (/TU)
  tooltip: string;
  required: boolean;
  readOnly: boolean;
  // Schriftgröße in Punkt; 0 = automatisch
  fontSize: number;
  // Nur Textfelder
  multiline: boolean;
  // Nur Auswahllisten
  options: string[];
  // Nur Dropdown: eigener Text erlaubt
  editable: boolean;
  // Nur Optionsfelder: Wert dieses Knopfes innerhalb der Gruppe
  exportValue: string;
}

export type FieldOperation =
  | { type: 'createField'; pageIndex: number; rect: Rect; kind: FieldKind; settings: FieldSettings }
  // rect: neue Lage (verschieben, Größe ändern); settings: neue Eigenschaften
  | { type: 'updateField'; ref: string; rect?: Rect; settings?: FieldSettings }
  | { type: 'deleteField'; ref: string };

export const DEFAULT_FIELD_SETTINGS: FieldSettings = {
  name: '',
  tooltip: '',
  required: false,
  readOnly: false,
  fontSize: 0,
  multiline: false,
  options: [],
  editable: false,
  exportValue: '',
};

// Standardgröße eines Feldes, wenn es per Klick (ohne Aufziehen) angelegt wird, in Punkt
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { width: number; height: number }> = {
  text: { width: 160, height: 22 },
  checkbox: { width: 14, height: 14 },
  radio: { width: 14, height: 14 },
  dropdown: { width: 160, height: 22 },
  list: { width: 160, height: 64 },
};

// Kleinste Seitenlänge eines Feldes in Punkt
export const MIN_FIELD_SIDE = 8;

export type FieldNameProblem = 'empty' | 'dot' | 'taken';

// Prüft einen neuen Feldnamen. taken: Namen anderer Felder (vollständige Namen).
// Optionsfelder dürfen einer vorhandenen Gruppe beitreten; dann ist der Name kein Fehler.
export function fieldNameProblem(name: string, taken: Iterable<string>, joinsGroup = false): FieldNameProblem | null {
  const value = name.trim();
  if (value === '') return 'empty';
  if (value.includes('.')) return 'dot';
  if (joinsGroup) return null;
  for (const other of taken) if (other === value) return 'taken';
  return null;
}

// Nächster freier Name nach dem Muster „Basis N“
export function nextFieldName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  for (let n = 1; ; n++) {
    const candidate = `${base} ${n}`;
    if (!names.has(candidate)) return candidate;
  }
}

// Bereinigt Eigenschaften vor dem Speichern (Leerraum, doppelte und leere Einträge, Grenzen)
export function normalizeFieldSettings(kind: FieldKind, settings: FieldSettings): FieldSettings {
  const options = [...new Set(settings.options.map((option) => option.trim()).filter((option) => option !== ''))];
  return {
    name: settings.name.trim(),
    tooltip: settings.tooltip.trim(),
    required: settings.required,
    readOnly: settings.readOnly,
    fontSize: Math.max(0, Math.min(96, Math.round(settings.fontSize * 2) / 2)),
    multiline: kind === 'text' && settings.multiline,
    options: kind === 'dropdown' || kind === 'list' ? options : [],
    editable: kind === 'dropdown' && settings.editable,
    exportValue: kind === 'radio' ? settings.exportValue.trim() : '',
  };
}
