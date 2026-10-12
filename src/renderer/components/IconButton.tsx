import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  size?: number;
}

// Schaltfläche nur mit Symbol. label ist Pflicht und dient als Tooltip und für Screenreader.
export function IconButton({ icon: Icon, label, pressed, size = 18, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={[styles.button, pressed ? styles.pressed : '', className ?? ''].join(' ')}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
