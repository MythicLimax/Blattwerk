import type { LucideIcon } from 'lucide-react';
import type { Tone } from './tone';
import styles from './ModeBadge.module.css';

// Name des aktiven Arbeitsbereichs am Anfang seiner Leiste, in der Farbe des Bereichs
export function ModeBadge({ tone, icon: Icon, label }: { tone: Tone; icon: LucideIcon; label: string }) {
  return (
    <span className={styles.badge} data-tone={tone} data-testid="mode-badge">
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
