import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import type { Tone } from './tone';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  size?: number;
  // Farbe des Arbeitsbereichs: Symbol in dieser Farbe, gedrückt als farbige Fläche
  tone?: Tone;
}

// Schaltfläche nur mit Symbol. label ist Pflicht und dient als Tooltip und für Screenreader.
export function IconButton({ icon: Icon, label, pressed, size = 18, tone, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, tone ? styles.toned : '', pressed ? styles.pressed : '', className ?? ''].join(' ')}
      data-tooltip={label}
      data-tone={tone}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
