// PDF/A (Phase 7, ADR 0017): prüfen und als neue Datei im Archivformat PDF/A-2b speichern.
import { PRODUCT_NAME } from '../../../shared/product';
import { api } from '../../api';
import { PDFJS_ASSETS } from '../../engine/pdfjs';
import { checkPdfA, convertToPdfA, PdfiumClientError } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import { pendingChanges } from '../../engine/session';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { busy, reportSaveNew } from '../pages/actions';
import { usePdfA } from './pdfa-store';

// Prüft die Datei im aktuellen Stand (ohne ungespeicherte Änderungen) und zeigt das Ergebnis
export async function openPdfACheck(tab: TabState): Promise<void> {
  const pdf = getRuntime(tab.id)?.pdf;
  if (!pdf) return;
  usePdfA.getState().setOpen(true);
  try {
    const report = await checkPdfA(await pdf.getData());
    if (usePdfA.getState().open) usePdfA.getState().setReport(report);
  } catch (error) {
    usePdfA.getState().setOpen(false);
    useUi.getState().notify(t('pdfa.checkFailed'), error instanceof Error ? error.message : String(error));
  }
}

async function cmykProfile(): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(`${PDFJS_ASSETS.iccUrl}CGATS001Compat-v2-micro.icc`);
    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// Umwandeln (mit ungespeicherten Kommentaren und Formularwerten) und als neue Datei speichern
export async function saveAsPdfA(tab: TabState): Promise<boolean> {
  const runtime = getRuntime(tab.id);
  if (!runtime?.pdf) return false;
  try {
    return await busy('pdfa.busy', async () => {
      const pending = await pendingChanges(tab.id);
      const bytes = await convertToPdfA(await runtime.pdf!.getData(), runtime.password, {
        ...pending,
        cmykProfile: await cmykProfile(),
        producer: PRODUCT_NAME,
      });
      const name = t('pdfa.fileName', { name: tab.name.replace(/\.pdf$/i, '') });
      return reportSaveNew(await api.saveNewFile(bytes, name, tab.fileId, true));
    });
  } catch (error) {
    const fonts = error instanceof PdfiumClientError && error.code === 'pdfa-fonts';
    const cmyk = error instanceof PdfiumClientError && error.code === 'pdfa-cmyk';
    useUi.getState().notify(t(fonts ? 'pdfa.fontsFailed' : cmyk ? 'pdfa.cmykFailed' : 'pdfa.failed'), error instanceof Error ? error.message : String(error));
    return false;
  }
}
