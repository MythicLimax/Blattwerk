import { FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../state/ui-store';
import styles from './DropOverlay.module.css';

export function DropOverlay() {
  const { t } = useTranslation();
  const dragging = useUi((s) => s.draggingFiles);
  const insert = useUi((s) => s.fileDropInsert);
  // Über dem Seitenraster zeigt das Raster selbst, wo eingefügt wird.
  if (!dragging || insert) return null;
  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.box}>
        <FileDown size={40} strokeWidth={1.5} />
        <span>{t('drop.message')}</span>
      </div>
    </div>
  );
}
