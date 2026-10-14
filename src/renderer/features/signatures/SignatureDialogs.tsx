import { Eraser, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SavedSignature, SignatureKind } from '../../../shared/ipc';
import { api } from '../../api';
import { Dialog, DialogButton } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { useAnnotations } from '../../state/annotations-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import { pickSources } from '../pages/actions';
import { imageToPng, strokesToPng, textToPng, toBase64, type SignaturePng, type StrokePoint } from './signature-image';
import styles from './SignatureDialogs.module.css';

// Schreibschriften des Systems für getippte Unterschriften (die erste verfügbare wird genutzt)
const SCRIPT_FONTS = [
  { id: 'snell', css: '"Snell Roundhand", "Segoe Script", cursive' },
  { id: 'chancery', css: '"Apple Chancery", "Lucida Handwriting", cursive' },
  { id: 'brush', css: '"Brush Script MT", "Segoe Script", cursive' },
] as const;

const INK_COLORS = [
  { id: 'black', css: '#111111' },
  { id: 'blue', css: '#1f3fae' },
] as const;

const PAD = { width: 520, height: 180 };

const close = () => useUi.getState().setSignatureDialog(null);

function place(signature: { image: string; width: number; height: number }): void {
  useAnnotations.getState().setPendingSignature(signature);
  close();
}

// Auswahl gespeicherter Unterschriften
export function ChooseSignatureDialog() {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<SavedSignature[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.signatures.list().then((list) => {
      if (!cancelled) setSaved(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async (id: string) => setSaved(await api.signatures.remove(id));

  return (
    <Dialog
      title={t('signatures.chooseTitle')}
      onClose={close}
      width={480}
      testId="signature-choose-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('signatures.cancel')}</DialogButton>
          <DialogButton primary onClick={() => useUi.getState().setSignatureDialog('create')} testId="signature-new">
            {t('signatures.new')}
          </DialogButton>
        </>
      }
    >
      {saved && saved.length === 0 && <p className={fieldStyles.message}>{t('signatures.none')}</p>}
      <ul className={styles.savedList}>
        {(saved ?? []).map((signature) => (
          <li key={signature.id} className={styles.savedItem}>
            <button
              type="button"
              className={styles.savedButton}
              data-tooltip={t('signatures.use')}
              onClick={() => place({ image: signature.png, width: signature.width, height: signature.height })}
              data-testid="signature-saved"
            >
              <img src={`data:image/png;base64,${signature.png}`} alt={t('signatures.savedAlt')} />
            </button>
            <IconButton icon={X} size={14} label={t('signatures.remove')} onClick={() => void remove(signature.id)} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// Zeichenfeld für die Maus, das Trackpad oder einen Stift
function DrawPad({ strokes, onChange, color }: { strokes: StrokePoint[][]; onChange: (strokes: StrokePoint[][]) => void; color: string }) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = PAD.width * ratio;
    canvas.height = PAD.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, PAD.width, PAD.height);
    context.strokeStyle = color;
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of strokes) {
      const [first, ...rest] = stroke;
      if (!first) continue;
      context.beginPath();
      context.moveTo(first.x, first.y);
      if (rest.length === 0) context.lineTo(first.x + 0.1, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }, [strokes, color]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): StrokePoint => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * PAD.width, y: ((event.clientY - box.top) / box.height) * PAD.height };
  };

  return (
    <div className={styles.padWrap}>
      <canvas
        ref={canvasRef}
        className={styles.pad}
        style={{ aspectRatio: `${PAD.width} / ${PAD.height}` }}
        aria-label={t('signatures.padLabel')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          onChange([...strokes, [point(event)]]);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
          const box = event.currentTarget.getBoundingClientRect();
          const added = (samples.length > 0 ? samples : [event.nativeEvent]).map((e) => ({
            x: ((e.clientX - box.left) / box.width) * PAD.width,
            y: ((e.clientY - box.top) / box.height) * PAD.height,
          }));
          const last = strokes.at(-1) ?? [];
          onChange([...strokes.slice(0, -1), [...last, ...added]]);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        data-testid="signature-pad"
      />
      <span className={styles.baseline}>{t('signatures.padHint')}</span>
    </div>
  );
}

type Mode = 'draw' | 'type' | 'image';

// Neue Unterschrift zeichnen, tippen oder aus einem Bild übernehmen
export function CreateSignatureDialog() {
  const { t } = useTranslation();
  const authorName = useUi((s) => s.authorName);
  const [mode, setMode] = useState<Mode>('draw');
  const [strokes, setStrokes] = useState<StrokePoint[][]>([]);
  const [color, setColor] = useState<string>(INK_COLORS[0].css);
  const [name, setName] = useState(authorName);
  const [font, setFont] = useState<string>(SCRIPT_FONTS[0].css);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [imagePreview, setImagePreview] = useState<SignaturePng | null>(null);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);

  // Vorschau des Bildes nach Hintergrund-Entfernung
  useEffect(() => {
    if (!imageBytes) return;
    let cancelled = false;
    void imageToPng(imageBytes, removeBackground).then((result) => {
      if (!cancelled) setImagePreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [imageBytes, removeBackground]);

  const ready = mode === 'draw' ? strokes.length > 0 : mode === 'type' ? name.trim() !== '' : imagePreview !== null;

  const chooseImage = async () => {
    const sources = await pickSources('images');
    const first = sources?.[0];
    if (first) setImageBytes(first.bytes);
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const kind: SignatureKind = mode === 'draw' ? 'drawn' : mode === 'type' ? 'typed' : 'image';
      const result =
        mode === 'draw' ? await strokesToPng(strokes, PAD, color) : mode === 'type' ? await textToPng(name, font, color) : imagePreview;
      if (!result) return;
      if (keep) await api.signatures.add({ kind, png: result.png, width: result.width, height: result.height });
      place({ image: toBase64(result.png), width: result.width, height: result.height });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('signatures.createTitle')}
      onClose={close}
      onSubmit={() => void submit()}
      width={600}
      testId="signature-create-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('signatures.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!ready || busy} testId="signature-use">
            {t('signatures.use')}
          </DialogButton>
        </>
      }
    >
      <div className={styles.tabs} role="tablist">
        {(['draw', 'type', 'image'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            className={mode === id ? styles.tabActive : styles.tab}
            onClick={() => setMode(id)}
            data-testid={`signature-mode-${id}`}
          >
            {t(`signatures.mode.${id}`)}
          </button>
        ))}
      </div>

      {mode !== 'image' && (
        <div className={styles.colorRow} role="radiogroup" aria-label={t('signatures.color')}>
          {INK_COLORS.map((ink) => (
            <button
              key={ink.id}
              type="button"
              role="radio"
              aria-checked={color === ink.css}
              className={styles.swatch}
              style={{ background: ink.css }}
              data-tooltip={t(`signatures.colors.${ink.id}`)}
              aria-label={t(`signatures.colors.${ink.id}`)}
              onClick={() => setColor(ink.css)}
            />
          ))}
          {mode === 'draw' && (
            <IconButton icon={Eraser} size={16} label={t('signatures.clear')} disabled={strokes.length === 0} onClick={() => setStrokes([])} />
          )}
        </div>
      )}

      {mode === 'draw' && <DrawPad strokes={strokes} onChange={setStrokes} color={color} />}

      {mode === 'type' && (
        <>
          <label className={fieldStyles.field}>
            <span>{t('signatures.name')}</span>
            <input className={fieldStyles.input} value={name} autoFocus onChange={(event) => setName(event.target.value)} data-testid="signature-name" />
          </label>
          <div className={styles.fontList} role="radiogroup" aria-label={t('signatures.font')}>
            {SCRIPT_FONTS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={font === option.css}
                className={font === option.css ? styles.fontActive : styles.fontOption}
                style={{ fontFamily: option.css, color }}
                onClick={() => setFont(option.css)}
              >
                {name.trim() || authorName}
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'image' && (
        <>
          <DialogButton onClick={() => void chooseImage()} testId="signature-image-pick">
            {t('signatures.pickImage')}
          </DialogButton>
          {imagePreview && (
            <div className={styles.imagePreview}>
              <img src={`data:image/png;base64,${toBase64(imagePreview.png)}`} alt={t('signatures.savedAlt')} data-testid="signature-image-preview" />
            </div>
          )}
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={removeBackground}
              onChange={(event) => setRemoveBackground(event.target.checked)}
              data-testid="signature-remove-background"
            />
            {t('signatures.removeBackground')}
          </label>
        </>
      )}

      <label className={styles.check}>
        <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} data-testid="signature-keep" />
        {t('signatures.keep')}
      </label>
    </Dialog>
  );
}
