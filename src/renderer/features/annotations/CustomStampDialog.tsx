import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogButton } from '../../components/Dialog';
import { CUSTOM_STAMP_COLORS, useAnnotations, type CustomStamp } from '../../state/annotations-store';
import styles from './CustomStampDialog.module.css';

// Eigener Stempel: Text, auf Wunsch mit Datum und Name in einer zweiten Zeile, in einer der Stempelfarben
export function CustomStampDialog({ onClose, onDone }: { onClose: () => void; onDone: (stamp: CustomStamp) => void }) {
  const { t } = useTranslation();
  const [stamp, setStamp] = useState<CustomStamp>(() => useAnnotations.getState().customStamp);
  const valid = stamp.text.trim() !== '';

  return (
    <Dialog
      title={t('comments.customStamp.title')}
      onClose={onClose}
      onSubmit={() => valid && onDone({ ...stamp, text: stamp.text.trim() })}
      testId="custom-stamp-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t('comments.customStamp.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!valid} testId="custom-stamp-ok">
            {t('comments.customStamp.ok')}
          </DialogButton>
        </>
      }
    >
      <label className={styles.field}>
        <span>{t('comments.customStamp.text')}</span>
        <input
          className={styles.input}
          value={stamp.text}
          maxLength={40}
          autoFocus
          onChange={(event) => setStamp({ ...stamp, text: event.target.value })}
          data-testid="custom-stamp-text"
        />
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={stamp.date} onChange={(event) => setStamp({ ...stamp, date: event.target.checked })} data-testid="custom-stamp-date" />
        {t('comments.customStamp.date')}
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={stamp.name} onChange={(event) => setStamp({ ...stamp, name: event.target.checked })} data-testid="custom-stamp-name" />
        {t('comments.customStamp.name')}
      </label>
      <div className={styles.colors} role="radiogroup" aria-label={t('comments.customStamp.color')}>
        {(Object.keys(CUSTOM_STAMP_COLORS) as Array<CustomStamp['color']>).map((id) => {
          const c = CUSTOM_STAMP_COLORS[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={stamp.color === id}
              aria-label={t(`comments.customStamp.colors.${id}`)}
              data-tooltip={t(`comments.customStamp.colors.${id}`)}
              className={styles.swatch}
              style={{ background: `rgb(${c.r * 255} ${c.g * 255} ${c.b * 255})` }}
              onClick={() => setStamp({ ...stamp, color: id })}
              data-testid={`custom-stamp-color-${id}`}
            />
          );
        })}
      </div>
    </Dialog>
  );
}
