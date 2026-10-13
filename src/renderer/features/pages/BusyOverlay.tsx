import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUi } from '../../state/ui-store';
import styles from './BusyOverlay.module.css';

// Hinweis während längerer Aufgaben ohne eigenen Tab (Zusammenführen, Extrahieren, Teilen)
export function BusyOverlay() {
  const { t } = useTranslation();
  const busy = useUi((s) => s.busy);
  if (!busy) return null;
  return (
    <div className={styles.overlay} role="status" data-testid="busy-overlay">
      <div className={styles.box}>
        <Loader2 size={22} className={styles.spin} aria-hidden="true" />
        <span>{t(busy)}</span>
      </div>
    </div>
  );
}
