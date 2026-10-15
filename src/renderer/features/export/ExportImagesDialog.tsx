import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExportImageKind } from '../../../shared/ipc';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { usePages } from '../stamping/StampDialogs';
import { exportImages } from './actions';

const close = () => useUi.getState().setExportImagesOpen(false);
const RESOLUTIONS = [72, 150, 300, 600] as const;
const QUALITIES = { high: 0.92, medium: 0.8, low: 0.6 } as const;

// Seiten als Bilder exportieren: Format, Auflösung, Seiten; danach Ordner wählen
export function ExportImagesDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportImageKind>('png');
  const [dpi, setDpi] = useState<number>(150);
  const [quality, setQuality] = useState<keyof typeof QUALITIES>('high');
  const { pages, invalid, field } = usePages(tab.pageCount);

  const submit = () => {
    if (invalid) return;
    close();
    void exportImages(tab, { format, dpi, quality: QUALITIES[quality], pages });
  };

  return (
    <Dialog
      title={t('export.imagesTitle')}
      onClose={close}
      onSubmit={submit}
      width={440}
      testId="export-images-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('export.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={invalid} testId="export-images-confirm">
            {t('export.chooseFolder')}
          </DialogButton>
        </>
      }
    >
      <label className={pageStyles.position}>
        {t('export.format')}
        <select className={pageStyles.select} value={format} onChange={(event) => setFormat(event.target.value as ExportImageKind)} data-testid="export-format">
          <option value="png">{t('export.formats.png')}</option>
          <option value="jpeg">{t('export.formats.jpeg')}</option>
        </select>
      </label>
      <label className={pageStyles.position}>
        {t('export.resolution')}
        <select className={pageStyles.select} value={dpi} onChange={(event) => setDpi(Number(event.target.value))} data-testid="export-dpi">
          {RESOLUTIONS.map((value) => (
            <option key={value} value={value}>
              {t('export.dpi', { value })}
            </option>
          ))}
        </select>
      </label>
      {format === 'jpeg' && (
        <label className={pageStyles.position}>
          {t('export.quality')}
          <select className={pageStyles.select} value={quality} onChange={(event) => setQuality(event.target.value as keyof typeof QUALITIES)}>
            {(Object.keys(QUALITIES) as Array<keyof typeof QUALITIES>).map((key) => (
              <option key={key} value={key}>
                {t(`export.qualities.${key}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      {field}
      <p className={fieldStyles.hint}>{t('export.imagesHint')}</p>
    </Dialog>
  );
}
