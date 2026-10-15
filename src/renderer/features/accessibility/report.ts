// Barrierefreiheit (Phase 7, ADR 0018): Prüfergebnis und Tags je geladenem Stand, einmal berechnet und geteilt von
// Tags-Leiste und Prüfdialog. Ein neuer Stand (Neuladen) hat ein neues pdf.js-Dokument und wird neu geprüft.
import type { AccessibilityReport } from '../../../shared/accessibility';
import { checkAccessibility } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import type { TabState } from '../../state/documents-store';

const reports = new WeakMap<object, Promise<AccessibilityReport>>();

export function accessibilityReport(tab: TabState): Promise<AccessibilityReport> | null {
  const runtime = getRuntime(tab.id);
  const pdf = runtime?.pdf;
  if (!runtime || !pdf) return null;
  let report = reports.get(pdf);
  if (!report) {
    report = pdf.getData().then((bytes) => checkAccessibility(bytes, runtime.password, tab.encrypted));
    // Fehler nicht zwischenspeichern: nächster Versuch prüft erneut
    report.catch(() => reports.delete(pdf));
    reports.set(pdf, report);
  }
  return report;
}
