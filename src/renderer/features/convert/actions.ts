// Textdokumente (Word, OpenDocument, RTF, Text, Markdown) in PDF umwandeln (ADR 0019). Umwandeln und Speichern
// erledigt der Hauptprozess; danach öffnet sich das neue PDF im Tab.
import type { ConvertResult } from '../../../shared/ipc';
import { api } from '../../api';
import { t } from '../../i18n';
import { useUi } from '../../state/ui-store';
import { busy, reportSaveNew } from '../pages/actions';

function report(result: ConvertResult): boolean {
  if (result.ok) return reportSaveNew(result);
  const { error } = result;
  if (['unsupported', 'legacy-doc', 'pages', 'invalid', 'too-large', 'unreadable', 'failed'].includes(error)) {
    useUi.getState().notify(t(`convert.errors.${error}`), result.detail);
    return false;
  }
  return reportSaveNew(result as Extract<ConvertResult, { error: 'cancelled' | 'write-failed' | 'invalid-data' | 'target-open' }>);
}

// file: abgelegte Datei; null: Auswahl im Dialog
export async function convertDocument(file: File | null): Promise<boolean> {
  try {
    const result = file ? await busy('convert.busy', () => api.convertDocument.dropped(file)) : await api.convertDocument.pick();
    return report(result);
  } catch (error) {
    useUi.getState().notify(t('convert.errors.failed'), error instanceof Error ? error.message : String(error));
    return false;
  }
}
