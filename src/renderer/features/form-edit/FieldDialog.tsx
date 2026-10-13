import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fieldNameProblem, normalizeFieldSettings, type FieldKind, type FieldSettings } from '../../../shared/forms';
import { Dialog, DialogButton } from '../../components/Dialog';
import { getRuntime } from '../../engine/runtime';
import { useFormEdit, type FieldDialogState } from '../../state/form-edit-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import pageStyles from '../pages/PageDialogs.module.css';
import { submitFieldDialog } from './actions';
import { fieldDirectory, type FieldDirectory } from './field-widgets';
import styles from './FieldDialog.module.css';

const FONT_SIZES = [0, 6, 8, 9, 10, 11, 12, 14, 16, 18, 24];

type Problem = 'empty' | 'dot' | 'taken' | 'valueEmpty' | 'valueTaken' | 'noOptions';

// Prüft die Eingaben gegen die vorhandenen Felder des Dokuments.
function findProblem(dialog: FieldDialogState, kind: FieldKind, prefix: string, partial: string, settings: FieldSettings, directory: FieldDirectory): Problem | null {
  const ownName = dialog.mode === 'edit' ? dialog.widget.settings.name : null;
  const taken = directory.names.filter((name) => name !== ownName);
  // Ein neuer Knopf darf einer vorhandenen Optionsgruppe beitreten.
  const joinsGroup = dialog.mode === 'create' && kind === 'radio' && directory.radioGroups.has(prefix + partial.trim());
  const nameProblem = fieldNameProblem(partial, [], false) ?? (taken.includes(prefix + partial.trim()) && !joinsGroup ? 'taken' : null);
  if (nameProblem) return nameProblem;
  if (kind === 'radio') {
    const value = settings.exportValue.trim();
    if (value === '') return 'valueEmpty';
    const group = directory.radioGroups.get(dialog.mode === 'edit' ? (ownName ?? '') : prefix + partial.trim()) ?? [];
    const ownValue = dialog.mode === 'edit' ? dialog.widget.settings.exportValue : null;
    if (group.filter((existing) => existing !== ownValue).includes(value)) return 'valueTaken';
  }
  if ((kind === 'dropdown' || kind === 'list') && settings.options.every((option) => option.trim() === '')) return 'noOptions';
  return null;
}

// Eigenschaften eines neuen oder vorhandenen Formularfeldes
export function FieldDialog({ dialog }: { dialog: FieldDialogState }) {
  const { t } = useTranslation();
  const id = useId();
  const kind: FieldKind = dialog.mode === 'create' ? dialog.kind : (dialog.widget.kind ?? 'text');
  const initial = dialog.mode === 'create' ? dialog.settings : dialog.widget.settings;
  // Bei Feldern in einer Hierarchie („adresse.ort“) ist nur der letzte Teil änderbar.
  const dot = dialog.mode === 'edit' ? initial.name.lastIndexOf('.') : -1;
  const prefix = dot >= 0 ? initial.name.slice(0, dot + 1) : '';
  const [partial, setPartial] = useState(initial.name.slice(prefix.length));
  const [settings, setSettings] = useState<FieldSettings>(initial);
  const [optionsText, setOptionsText] = useState(initial.options.join('\n'));
  const [directory, setDirectory] = useState<FieldDirectory | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const pdf = getRuntime(dialog.tabId)?.pdf;
    if (!pdf) return;
    let cancelled = false;
    void fieldDirectory(pdf).then((result) => {
      if (!cancelled) setDirectory(result);
    });
    return () => {
      cancelled = true;
    };
  }, [dialog.tabId]);

  const close = () => useFormEdit.getState().setDialog(null);
  const patch = (next: Partial<FieldSettings>) => setSettings((current) => ({ ...current, ...next }));
  const current: FieldSettings = { ...settings, name: prefix + partial, options: optionsText.split('\n') };
  const problem = directory ? findProblem(dialog, kind, prefix, partial, current, directory) : null;

  const submit = () => {
    setTouched(true);
    if (!directory || problem) return;
    void submitFieldDialog(dialog, normalizeFieldSettings(kind, current));
  };

  const kindLabel = t(`formEdit.kinds.${kind}`);
  const title = dialog.mode === 'create' ? t('formEdit.dialog.createTitle', { kind: kindLabel }) : t('formEdit.dialog.editTitle', { kind: kindLabel });
  const radioGroups = directory ? [...directory.radioGroups.keys()] : [];
  const fontSizes = FONT_SIZES.includes(settings.fontSize) ? FONT_SIZES : [...FONT_SIZES, settings.fontSize].sort((a, b) => a - b);

  return (
    <Dialog
      title={title}
      onClose={close}
      onSubmit={submit}
      width={440}
      testId="field-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('formEdit.dialog.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!directory} testId="field-dialog-ok">
            {dialog.mode === 'create' ? t('formEdit.dialog.create') : t('formEdit.dialog.ok')}
          </DialogButton>
        </>
      }
    >
      <div className={styles.grid}>
        <label className={fieldStyles.field}>
          <span>{kind === 'radio' ? t('formEdit.dialog.group') : t('formEdit.dialog.name')}</span>
          <span className={styles.nameRow}>
            {prefix && <span className={styles.prefix}>{prefix}</span>}
            <input
              className={fieldStyles.input}
              value={partial}
              autoFocus
              list={kind === 'radio' && dialog.mode === 'create' ? `${id}-groups` : undefined}
              onChange={(event) => setPartial(event.target.value)}
              data-testid="field-name"
            />
          </span>
          {kind === 'radio' && dialog.mode === 'create' && (
            <datalist id={`${id}-groups`}>
              {radioGroups.map((group) => (
                <option key={group} value={group} />
              ))}
            </datalist>
          )}
        </label>
        {kind === 'radio' && <p className={fieldStyles.hint}>{t('formEdit.dialog.groupHint')}</p>}

        {kind === 'radio' && (
          <label className={fieldStyles.field}>
            <span>{t('formEdit.dialog.value')}</span>
            <input
              className={fieldStyles.input}
              value={settings.exportValue}
              onChange={(event) => patch({ exportValue: event.target.value })}
              data-testid="field-value"
            />
          </label>
        )}

        {(kind === 'dropdown' || kind === 'list') && (
          <label className={fieldStyles.field}>
            <span>{t('formEdit.dialog.options')}</span>
            <textarea
              className={styles.options}
              rows={5}
              value={optionsText}
              onChange={(event) => setOptionsText(event.target.value)}
              data-testid="field-options"
            />
          </label>
        )}

        <label className={fieldStyles.field}>
          <span>{t('formEdit.dialog.tooltip')}</span>
          <input
            className={fieldStyles.input}
            value={settings.tooltip}
            onChange={(event) => patch({ tooltip: event.target.value })}
            data-testid="field-tooltip"
          />
        </label>

        {(kind === 'text' || kind === 'dropdown' || kind === 'list') && (
          <label className={pageStyles.position}>
            <span>{t('formEdit.dialog.fontSize')}</span>
            <select
              className={pageStyles.select}
              value={settings.fontSize}
              onChange={(event) => patch({ fontSize: Number(event.target.value) })}
              data-testid="field-font-size"
            >
              {fontSizes.map((size) => (
                <option key={size} value={size}>
                  {size === 0 ? t('formEdit.dialog.fontAuto') : t('formEdit.dialog.fontValue', { value: size })}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className={styles.checks}>
          <label className={pageStyles.check}>
            <input type="checkbox" checked={settings.required} onChange={(event) => patch({ required: event.target.checked })} data-testid="field-required" />
            {t('formEdit.dialog.required')}
          </label>
          <label className={pageStyles.check}>
            <input type="checkbox" checked={settings.readOnly} onChange={(event) => patch({ readOnly: event.target.checked })} data-testid="field-readonly" />
            {t('formEdit.dialog.readOnly')}
          </label>
          {kind === 'text' && (
            <label className={pageStyles.check}>
              <input type="checkbox" checked={settings.multiline} onChange={(event) => patch({ multiline: event.target.checked })} data-testid="field-multiline" />
              {t('formEdit.dialog.multiline')}
            </label>
          )}
          {kind === 'dropdown' && (
            <label className={pageStyles.check}>
              <input type="checkbox" checked={settings.editable} onChange={(event) => patch({ editable: event.target.checked })} data-testid="field-editable" />
              {t('formEdit.dialog.editable')}
            </label>
          )}
        </div>

        {touched && problem && (
          <p className={fieldStyles.error} role="alert" data-testid="field-problem">
            {t(`formEdit.dialog.problems.${problem}`)}
          </p>
        )}
      </div>
    </Dialog>
  );
}
