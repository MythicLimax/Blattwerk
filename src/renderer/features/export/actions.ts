// Export als Bilder und als Text (Phase 6, ADR 0012). Gezeichnet und ausgelesen wird im PDFium-Worker (Sitzung),
// geschrieben Seite für Seite über den Hauptprozess. Ungespeicherte Kommentare und Formularwerte sind enthalten.
import type { ExportImageKind } from '../../../shared/ipc';
import { api } from '../../api';
import { closeSession, openSession, pageText, renderPage } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import { pendingChanges } from '../../engine/session';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { withProgress } from '../progress/progress';

export interface ImageExportOptions {
  format: ExportImageKind;
  dpi: number;
  // JPEG-Qualität 0 bis 1
  quality: number;
  // 0-basiert; null = alle Seiten
  pages: number[] | null;
}

const baseName = (tab: TabState) => tab.name.replace(/\.pdf$/i, '');

// Kopieren verboten (Berechtigungen): dann auch kein Export, wie in anderen Programmen
function allowed(tab: TabState): boolean {
  if (tab.canExtract) return true;
  useUi.getState().notify(t('export.notAllowed'));
  return false;
}

async function withSession<T>(tab: TabState, fn: (session: number, pageCount: number) => Promise<T>): Promise<T> {
  const runtime = getRuntime(tab.id);
  if (!runtime?.pdf) throw new Error('Dokument nicht geladen');
  const pending = await pendingChanges(tab.id);
  const { session, pageCount } = await openSession(await runtime.pdf.getData(), runtime.password, pending);
  try {
    return await fn(session, pageCount);
  } finally {
    await closeSession(session);
  }
}

export async function exportImages(tab: TabState, options: ImageExportOptions): Promise<void> {
  if (!allowed(tab)) return;
  const folder = await api.exportImages.chooseFolder(tab.fileId);
  if (!folder.ok) return;
  const pages = options.pages ?? Array.from({ length: tab.pageCount }, (_, i) => i);
  const digits = String(tab.pageCount).length;
  try {
    const written = await withProgress('export.imagesProgress', pages.length, (progress) =>
      withSession(tab, async (session) => {
        let count = 0;
        for (const [i, pageIndex] of pages.entries()) {
          progress.step(i, { key: 'export.pageStep', values: { page: pageIndex + 1, count: tab.pageCount } });
          const image = await renderPage(session, pageIndex, options.dpi, options.format, options.quality);
          progress.step(i);
          const name = `${baseName(tab)} – ${t('export.pageName')} ${String(pageIndex + 1).padStart(digits, '0')}`;
          const result = await api.exportImages.write(folder.token, name, options.format, image.bytes);
          if (!result.ok) throw new Error(`${result.error}${result.detail ? `: ${result.detail}` : ''}`);
          count++;
        }
        return count;
      }),
    );
    if (written !== null) useUi.getState().confirm(t('export.imagesDone', { count: written, folder: folder.folder }));
  } catch (error) {
    useUi.getState().notify(t('export.failed'), error instanceof Error ? error.message : String(error));
  } finally {
    await api.exportImages.end(folder.token);
  }
}

// Text aller Seiten in Lesereihenfolge; zwischen den Seiten eine Leerzeile
export async function exportText(tab: TabState): Promise<void> {
  if (!allowed(tab)) return;
  try {
    const text = await withProgress('export.textProgress', tab.pageCount, (progress) =>
      withSession(tab, async (session, pageCount) => {
        const parts: string[] = [];
        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
          progress.step(pageIndex, { key: 'export.pageStep', values: { page: pageIndex + 1, count: pageCount } });
          parts.push((await pageText(session, pageIndex)).trimEnd());
        }
        return `${parts.join('\n\n')}\n`;
      }),
    );
    if (text === null) return;
    if (text.trim() === '') {
      useUi.getState().notify(t('export.noText'));
      return;
    }
    const result = await api.exportText(text, baseName(tab), tab.fileId);
    if (result.ok) useUi.getState().confirm(t('export.textDone', { name: result.name }));
    else if (result.error !== 'cancelled') useUi.getState().notify(t('export.failed'), result.detail ?? result.error);
  } catch (error) {
    useUi.getState().notify(t('export.failed'), error instanceof Error ? error.message : String(error));
  }
}
