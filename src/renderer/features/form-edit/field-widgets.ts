// Formularfelder einer Seite und alle Feldnamen des Dokuments aus pdf.js (für die Bearbeitungsebene).
import { normalizeRect, type Rect } from '../../../shared/annotations';
import { DEFAULT_FIELD_SETTINGS, type FieldKind } from '../../../shared/forms';
import type { FieldWidget } from '../../state/form-edit-store';

// Ausschnitt der Widget-Daten von pdf.js (getAnnotations)
interface PdfjsWidget {
  subtype?: string;
  id?: string;
  rect?: number[];
  fieldType?: string | null;
  fieldName?: string;
  fieldFlags?: number;
  alternativeText?: string;
  required?: boolean;
  readOnly?: boolean;
  multiLine?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  combo?: boolean;
  buttonValue?: string | null;
  options?: Array<{ exportValue?: string; displayValue?: string }>;
  defaultAppearanceData?: { fontSize?: number };
}

interface PdfLike {
  getPage(pageNumber: number): Promise<{ getAnnotations(params?: { intent?: string }): Promise<unknown[]> }>;
  getFieldObjects(): Promise<unknown>;
}

// Dropdown erlaubt eigenen Text (PDF 32000, Tabelle 230)
const FLAG_EDIT = 1 << 18;

function kindOf(widget: PdfjsWidget): FieldKind | null {
  switch (widget.fieldType) {
    case 'Tx':
      return 'text';
    case 'Btn':
      return widget.checkBox ? 'checkbox' : widget.radioButton ? 'radio' : null;
    case 'Ch':
      return widget.combo ? 'dropdown' : 'list';
    default:
      return null;
  }
}

export function toFieldWidget(raw: unknown, pageIndex: number): FieldWidget | null {
  const widget = raw as PdfjsWidget;
  if (widget.subtype !== 'Widget' || !widget.id || !widget.fieldType || !Array.isArray(widget.rect) || widget.rect.length !== 4) return null;
  const kind = kindOf(widget);
  return {
    ref: widget.id,
    pageIndex,
    rect: normalizeRect(widget.rect as Rect),
    kind,
    settings: {
      ...DEFAULT_FIELD_SETTINGS,
      name: widget.fieldName ?? '',
      tooltip: widget.alternativeText ?? '',
      required: Boolean(widget.required),
      readOnly: Boolean(widget.readOnly),
      fontSize: widget.defaultAppearanceData?.fontSize ?? 0,
      multiline: kind === 'text' && Boolean(widget.multiLine),
      options: kind === 'dropdown' || kind === 'list' ? (widget.options ?? []).map((o) => o.displayValue ?? o.exportValue ?? '') : [],
      editable: kind === 'dropdown' && ((widget.fieldFlags ?? 0) & FLAG_EDIT) !== 0,
      exportValue: kind === 'radio' ? (widget.buttonValue ?? '') : '',
    },
  };
}

// Je pdf.js-Dokument einmal geladen (ein neuer Stand ist ein neues Dokument)
const pageCache = new WeakMap<object, Map<number, Promise<FieldWidget[]>>>();

export function pageWidgets(pdf: PdfLike, pageIndex: number): Promise<FieldWidget[]> {
  let pages = pageCache.get(pdf);
  if (!pages) {
    pages = new Map();
    pageCache.set(pdf, pages);
  }
  let cached = pages.get(pageIndex);
  if (!cached) {
    cached = pdf
      .getPage(pageIndex + 1)
      .then((page) => page.getAnnotations({ intent: 'display' }))
      .then((list) => list.map((raw) => toFieldWidget(raw, pageIndex)).filter((w): w is FieldWidget => w !== null))
      .catch(() => []);
    pages.set(pageIndex, cached);
  }
  return cached;
}

export interface FieldDirectory {
  // Vollständige Namen aller Felder
  names: string[];
  // Optionsgruppen mit den Werten ihrer Knöpfe
  radioGroups: Map<string, string[]>;
}

const directoryCache = new WeakMap<object, Promise<FieldDirectory>>();

export function fieldDirectory(pdf: PdfLike): Promise<FieldDirectory> {
  let cached = directoryCache.get(pdf);
  if (!cached) {
    cached = pdf
      .getFieldObjects()
      .then((fields) => {
        type Entry = { type?: string; exportValues?: string; page?: number };
        const map = fields instanceof Map ? (fields as Map<string, Entry[]>) : new Map<string, Entry[]>();
        const radioGroups = new Map<string, string[]>();
        for (const [name, list] of map) {
          const buttons = list.filter((entry) => entry.type === 'radiobutton' && (entry.page ?? -1) >= 0);
          if (buttons.length > 0) radioGroups.set(name, buttons.map((entry) => entry.exportValues ?? ''));
        }
        return { names: [...map.keys()], radioGroups };
      })
      .catch(() => ({ names: [], radioGroups: new Map<string, string[]>() }));
    directoryCache.set(pdf, cached);
  }
  return cached;
}
