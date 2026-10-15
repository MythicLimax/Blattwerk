// Texterkennung (Phase 6, ADR 0015): Seiten ohne Text zeichnen (300 dpi), erkennen, als unsichtbare Textebene einfügen.
// Das Ergebnis ist ein neuer Dokumentstand (Rückgängig möglich); die Datei ändert sich erst beim Speichern.
import type { ContentOperation } from '../../../shared/content';
import { hasTextLayer, rgbaToPgm, wordsFromBlocks } from '../../../shared/ocr';
import { startOcr, type OcrEngine, type OcrLanguage } from '../../engine/ocr-client';
import { closeSession, openSession, pageText, renderPage } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import { applyContentOperations, pendingChanges } from '../../engine/session';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { withProgress } from '../progress/progress';

export const OCR_DPI = 300;

export interface OcrOptions {
  // 0-basiert; null = alle Seiten
  pages: number[] | null;
  languages: OcrLanguage[];
}

export async function recognizeText(tab: TabState, options: OcrOptions): Promise<void> {
  const ui = useUi.getState();
  if (!tab.canModify) {
    ui.notify(t('contentEdit.notAllowed'));
    return;
  }
  const runtime = getRuntime(tab.id);
  if (!runtime?.pdf) return;
  const pages = options.pages ?? Array.from({ length: tab.pageCount }, (_, i) => i);
  let skipped = 0;
  let engine: OcrEngine | null = null;
  let session: number | null = null;
  try {
    const operations = await withProgress('ocr.progress', pages.length, async (progress) => {
      progress.step(0, { key: 'ocr.loading' });
      const opened = await openSession(await runtime.pdf!.getData(), runtime.password, await pendingChanges(tab.id));
      session = opened.session;
      engine = await startOcr(options.languages);
      const result: ContentOperation[] = [];
      for (const [i, pageIndex] of pages.entries()) {
        progress.step(i, { key: 'ocr.pageStep', values: { page: pageIndex + 1, count: tab.pageCount } });
        // Seiten mit Text (kein Scan oder schon erkannt) bleiben unverändert
        if (hasTextLayer(await pageText(opened.session, pageIndex))) {
          skipped++;
          continue;
        }
        const image = await renderPage(opened.session, pageIndex, OCR_DPI, 'rgba');
        progress.step(i);
        const blocks = await engine.recognize(rgbaToPgm(image.bytes, image.width, image.height));
        progress.step(i);
        const words = wordsFromBlocks(blocks);
        if (words.length > 0) result.push({ type: 'ocrText', pageIndex, width: image.width, height: image.height, words });
      }
      progress.step(pages.length, { key: 'ocr.applying' });
      return result;
    });
    if (operations === null) return;
    if (operations.length === 0) {
      ui.confirm(skipped === pages.length ? t('ocr.allHaveText') : t('ocr.nothingFound'));
      return;
    }
    if (await applyContentOperations(tab.id, operations, { keepScroll: true })) {
      ui.confirm(t('ocr.done', { count: operations.length, skipped }));
    }
  } catch (error) {
    ui.notify(t('ocr.failed'), error instanceof Error ? error.message : String(error));
  } finally {
    if (session !== null) await closeSession(session);
    await (engine as OcrEngine | null)?.stop().catch(() => undefined);
  }
}
