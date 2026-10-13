// Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen (Phase 5): Dialoge öffnen, Operationen ausführen.
import type { StampOperation } from '../../../shared/stamping';
import { applyStampOperations, commitPendingEdits } from '../../engine/session';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';

export type StampDialogKind = 'watermark' | 'headerFooter' | 'pageNumbers';

function allowed(tab: TabState): boolean {
  if (tab.status !== 'ready') return false;
  if (tab.encrypted) {
    useUi.getState().notify(t('errors.pages.stamp-encrypted'));
    return false;
  }
  return true;
}

export function openStampDialog(tab: TabState, kind: StampDialogKind): void {
  if (!allowed(tab)) return;
  commitPendingEdits();
  useUi.getState().setStampDialog(kind);
}

export function removeArtifacts(tab: TabState, kind: 'watermark' | 'headerFooter'): void {
  if (!allowed(tab)) return;
  void applyStampOperations(tab.id, [{ type: 'removeArtifacts', kind }], { keepScroll: true }).then((ok) => {
    if (ok) useUi.getState().confirm(t(kind === 'watermark' ? 'stamp.watermarkRemoved' : 'stamp.headerFooterRemoved'));
  });
}

export async function runStamp(tab: TabState, operation: StampOperation): Promise<boolean> {
  useUi.getState().setStampDialog(null);
  return applyStampOperations(tab.id, [operation], { keepScroll: true });
}

// Heutiges Datum für den Platzhalter {Datum}
export function today(): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
}

// Millimeter in Punkt (1 Zoll = 25,4 mm = 72 pt)
export const mmToPt = (mm: number) => (mm * 72) / 25.4;
