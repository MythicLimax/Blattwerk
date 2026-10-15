// Zwei PDFs vergleichen (Phase 6, ADR 0014): das geöffnete Dokument (mit ungespeicherten Änderungen) als alte Fassung,
// eine gewählte Datei als neue. Der Bericht wird als neues PDF gespeichert und geöffnet.
import type { CompareLabels } from '../../../shared/compare';
import { api } from '../../api';
import { compareDocuments } from '../../engine/pdfium-client';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { busy, currentBytes, pickSources, reportSaveNew } from '../pages/actions';

const labels = (): CompareLabels => ({
  title: t('compare.report.title'),
  oldFile: t('compare.report.oldFile'),
  newFile: t('compare.report.newFile'),
  summary: t('compare.report.summary'),
  noChanges: t('compare.report.noChanges'),
  page: t('compare.report.page'),
  noPage: t('compare.report.noPage'),
  pageLine: t('compare.report.pageLine'),
  pagesAdded: t('compare.report.pagesAdded'),
  pagesRemoved: t('compare.report.pagesRemoved'),
  legend: t('compare.report.legend'),
});

const baseName = (name: string) => name.replace(/\.pdf$/i, '');

export async function compareWithFile(tab: TabState): Promise<boolean> {
  const picked = await pickSources('pdf');
  const other = picked?.[0];
  if (!other) return false;
  try {
    return await busy('compare.busy', async () => {
      const current = await currentBytes(tab);
      const report = await compareDocuments(current, { bytes: other.bytes, password: other.password }, { old: tab.name, new: other.name }, labels());
      const name = t('compare.fileName', { old: baseName(tab.name), new: baseName(other.name) });
      return reportSaveNew(await api.saveNewFile(report, name, tab.fileId, true));
    });
  } catch (error) {
    useUi.getState().notify(t('compare.failed'), error instanceof Error ? error.message : String(error));
    return false;
  }
}
