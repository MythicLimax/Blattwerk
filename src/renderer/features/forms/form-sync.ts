// Gleicht die Eingaben in Formularfeldern (pdf.js-Anmerkungsspeicher) mit dem Stand der Datei ab.
import { computeFormChanges, type WidgetInfo } from '../../../shared/forms';
import { getRuntime } from '../../engine/runtime';
import type { FormFieldValue } from '../../../shared/forms';
import { formChanges, useForms } from '../../state/forms-store';

// Felder des Dokuments je pdf.js-Dokument (einmal geladen)
const widgetCache = new WeakMap<object, Promise<Map<string, WidgetInfo>>>();

async function widgetsOf(pdf: { getFieldObjects(): Promise<unknown> }): Promise<Map<string, WidgetInfo>> {
  let cached = widgetCache.get(pdf);
  if (!cached) {
    cached = pdf
      .getFieldObjects()
      .then((fields) => {
        const map = new Map<string, WidgetInfo>();
        const entries = fields instanceof Map ? (fields as Map<string, WidgetInfo[]>) : new Map<string, WidgetInfo[]>();
        for (const list of entries.values()) for (const widget of list) if (widget.page >= 0) map.set(widget.id, widget);
        return map;
      })
      .catch(() => new Map<string, WidgetInfo>());
    widgetCache.set(pdf, cached);
  }
  return cached;
}

// Ermittelt die geänderten Feldwerte eines Tabs neu (nach jeder Eingabe in ein Feld).
export async function syncFormChanges(tabId: string): Promise<void> {
  const pdf = getRuntime(tabId)?.pdf;
  if (!pdf) return;
  const widgets = await widgetsOf(pdf as unknown as { getFieldObjects(): Promise<unknown> });
  if (getRuntime(tabId)?.pdf !== pdf || widgets.size === 0) return;
  const storage = pdf.annotationStorage as unknown as Iterable<[string, unknown]>;
  useForms.getState().setChanges(tabId, computeFormChanges(storage, widgets));
}

// Frischer Stand der geänderten Feldwerte (vor Speichern, Drucken und Seitenoperationen)
export async function currentFormChanges(tabId: string): Promise<FormFieldValue[]> {
  await syncFormChanges(tabId);
  return formChanges(tabId);
}
