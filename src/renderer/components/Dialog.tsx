import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import styles from './Dialog.module.css';

interface DialogProps {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  width?: number;
  testId?: string;
}

// Modaler Dialog auf Basis von <dialog>: Fokus bleibt im Dialog, Esc schließt.
export function Dialog({ title, children, actions, onClose, onSubmit, width = 420, testId }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={{ width }}
      aria-label={title}
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form method="dialog" onSubmit={handleSubmit} className={styles.form}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.body}>{children}</div>
        <div className={styles.actions}>{actions}</div>
      </form>
    </dialog>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
  autoFocus?: boolean;
}

export function DialogButton({ children, onClick, primary, type = 'button', disabled, autoFocus }: ButtonProps) {
  return (
    <button
      type={type}
      className={primary ? styles.primary : styles.secondary}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
    >
      {children}
    </button>
  );
}
