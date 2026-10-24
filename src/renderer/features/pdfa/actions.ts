// PDF/A (Phase 7, ADR 0017): prüfen und als neue Datei im Archivformat PDF/A-2b speichern.
import { PRODUCT_NAME } from '../../../shared/product';
import { api } from '../../api';
import { PDFJS_ASSETS } from '../../engine/pdfjs';
import { checkPdfA, convertToPdfA, PdfiumClientError } from '../../engine/pdfium-client';
import { systemFontFor } from '../../../shared/fonts';
import { systemFontData } from '../content-edit/system-fonts';
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

// Nicht eingebettete Schriften, für die es eine passende Schrift des Rechners gibt (z. B. Calibri aus Office)
async function systemFontsFor(bytes: Uint8Array): Promise<Array<{ baseFont: string; data: ArrayBuffer }>> {
  const report = await checkPdfA(bytes).catch(() => null);
  const names = (report?.issues.find((issue) => issue.code === 'fonts')?.detail ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '' && name !== '?');
  if (names.length === 0) return [];
  const fonts = await api.fonts.list().catch(() => []);
  const result: Array<{ baseFont: string; data: ArrayBuffer }> = [];
  for (const baseFont of names) {
    const key = systemFontFor(baseFont, fonts);
    const font = key ? await systemFontData(key) : null;
    if (font) result.push({ baseFont, data: font.slice().buffer as ArrayBuffer });
  }
  return result;
}

// Umwandeln (mit ungespeicherten Kommentaren und Formularwerten) und als neue Datei speichern
export async function saveAsPdfA(tab: TabState): Promise<boolean> {
  const runtime = getRuntime(tab.id);
  if (!runtime?.pdf) return false;
  try {
    return await busy('pdfa.busy', async () => {
      const pending = await pendingChanges(tab.id);
      const data = await runtime.pdf!.getData();
      const bytes = await convertToPdfA(data, runtime.password, {
        ...pending,
        cmykProfile: await cmykProfile(),
        producer: PRODUCT_NAME,
        systemFonts: await systemFontsFor(data),
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
