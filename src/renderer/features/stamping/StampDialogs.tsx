import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../../shared/annotations';
import { systemFontKey, type TextFont } from '../../../shared/fonts';
import { parsePageRanges, type ImageSource } from '../../../shared/pages';
import {
  EMPTY_TEXTS,
  pageNumberText,
  PAGE_NUMBER_FORMATS,
  STAMP_FONTS,
  STAMP_TOKENS,
  type HeaderFooterTexts,
  type HorizontalAlign,
  type PageNumberFormat,
  type PageNumberPosition,
  type VerticalAlign,
} from '../../../shared/stamping';
import { Dialog, DialogButton } from '../../components/Dialog';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import fieldStyles from '../password/PasswordDialog.module.css';
import { imageSource, pickSources } from '../pages/actions';
import pageStyles from '../pages/PageDialogs.module.css';
import { mmToPt, runStamp, today } from './actions';
import { fontLabel, useSystemFonts } from '../content-edit/system-fonts';
import styles from './StampDialogs.module.css';

const close = () => useUi.getState().setStampDialog(null);

const COLORS: Array<{ id: string; color: Rgb }> = [
  { id: 'gray', color: { r: 0.5, g: 0.5, b: 0.5 } },
  { id: 'red', color: { r: 0.8, g: 0.1, b: 0.1 } },
  { id: 'blue', color: { r: 0.15, g: 0.3, b: 0.75 } },
  { id: 'black', color: { r: 0, g: 0, b: 0 } },
];

const toCss = ({ r, g, b }: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

function ColorChoice({ value, onChange }: { value: Rgb; onChange: (color: Rgb) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.swatches} role="radiogroup" aria-label={t('stamp.color')}>
      {COLORS.map(({ id, color }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === color}
          className={styles.swatch}
          style={{ background: toCss(color) }}
          data-tooltip={t(`stamp.colors.${id}`)}
          aria-label={t(`stamp.colors.${id}`)}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.row}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// Standardschriften (Westeuropa) und Schriften des Rechners (alle Schriftsysteme, werden eingebettet; ADR 0024)
function FontSelect({ value, onChange }: { value: TextFont; onChange: (font: TextFont) => void }) {
  const { t } = useTranslation();
  const systemFonts = useSystemFonts((s) => s.fonts);
  useEffect(() => useSystemFonts.getState().load(), []);
  const styleNames = { bold: t('contentEdit.fontStyles.bold'), italic: t('contentEdit.fontStyles.italic'), boldItalic: t('contentEdit.fontStyles.boldItalic') };
  return (
    <select className={pageStyles.select} value={value} onChange={(event) => onChange(event.target.value as TextFont)} data-testid="stamp-font">
      <optgroup label={t('contentEdit.fontsStandard')}>
        {STAMP_FONTS.map((font) => (
          <option key={font} value={font}>
            {t(`stamp.fonts.${font}`)}
          </option>
        ))}
      </optgroup>
      {systemFonts.length > 0 && (
        <optgroup label={t('contentEdit.fontsSystem')}>
          {systemFonts.flatMap((family) =>
            family.styles.map((variant) => {
              const key = systemFontKey(family.id, variant);
              return (
                <option key={key} value={key}>
                  {fontLabel(key, systemFonts, styleNames)}
                </option>
              );
            }),
          )}
        </optgroup>
      )}
    </select>
  );
}

// Alle Seiten oder ein Bereich („1-3, 5“); liefert null = alle, sonst 0-basierte Seiten oder einen Fehler
export function usePages(pageCount: number) {
  const { t } = useTranslation();
  const [all, setAll] = useState(true);
  const [text, setText] = useState(`1-${pageCount}`);
  const parsed = all ? null : parsePageRanges(text, pageCount);
  const invalid = !all && parsed === null ? t('pages.dialog.invalidPages', { count: pageCount }) : null;
  const field = (
    <div className={styles.pages}>
      <label className={pageStyles.check}>
        <input type="radio" checked={all} onChange={() => setAll(true)} />
        {t('stamp.allPages')}
      </label>
      <label className={pageStyles.check}>
        <input type="radio" checked={!all} onChange={() => setAll(false)} data-testid="stamp-pages-range" />
        {t('stamp.somePages')}
        <input
          className={fieldStyles.input}
          value={text}
          disabled={all}
          onChange={(event) => setText(event.target.value)}
          aria-label={t('pages.dialog.pages', { count: pageCount })}
          data-testid="stamp-pages"
        />
      </label>
      {invalid && (
        <p className={fieldStyles.error} role="alert">
          {invalid}
        </p>
      )}
    </div>
  );
  return { pages: parsed, invalid: invalid !== null, field };
}

export function WatermarkDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [source, setSource] = useState<'text' | 'image'>('text');
  const [text, setText] = useState(t('stamp.defaultWatermark'));
  const [font, setFont] = useState<TextFont>('HelveticaBold');
  const [size, setSize] = useState(0);
  const [color, setColor] = useState<Rgb>((COLORS[1] as { color: Rgb }).color);
  const [image, setImage] = useState<{ name: string; source: ImageSource } | null>(null);
  const [scale, setScale] = useState(50);
  const [opacity, setOpacity] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [vertical, setVertical] = useState<VerticalAlign>('middle');
  const [horizontal, setHorizontal] = useState<HorizontalAlign>('center');
  const [behind, setBehind] = useState(false);
  const [replace, setReplace] = useState(true);
  const pages = usePages(tab.pageCount);
  const ready = !pages.invalid && (source === 'text' ? text.trim() !== '' : image !== null);

  const chooseImage = async () => {
    const picked = await pickSources('images');
    const first = picked?.[0];
    if (first?.image) setImage({ name: first.name, source: imageSource(first) });
  };

  const submit = () => {
    if (!ready) return;
    const common = { opacity: opacity / 100, rotation, vertical, horizontal, behind, pages: pages.pages };
    const spec =
      source === 'text'
        ? { ...common, kind: 'text' as const, text: text.trim(), font, size, color }
        : { ...common, kind: 'image' as const, image: (image as { source: ImageSource }).source, scale };
    void runStamp(tab, { type: 'addWatermark', spec, replace });
  };

  return (
    <Dialog
      title={t('stamp.watermarkTitle')}
      onClose={close}
      onSubmit={submit}
      width={480}
      testId="watermark-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('stamp.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!ready} testId="stamp-ok">
            {t('stamp.add')}
          </DialogButton>
        </>
      }
    >
      <div className={styles.tabs} role="tablist">
        {(['text', 'image'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={source === id}
            className={source === id ? styles.tabActive : styles.tab}
            onClick={() => setSource(id)}
            data-testid={`watermark-source-${id}`}
          >
            {t(`stamp.source.${id}`)}
          </button>
        ))}
      </div>
      <div className={styles.grid}>
        {source === 'text' ? (
          <>
            <Row label={t('stamp.text')}>
              <input className={fieldStyles.input} value={text} autoFocus onChange={(event) => setText(event.target.value)} data-testid="watermark-text" />
            </Row>
            <Row label={t('stamp.font')}>
              <FontSelect value={font} onChange={setFont} />
            </Row>
            <Row label={t('stamp.size')}>
              <select className={pageStyles.select} value={size} onChange={(event) => setSize(Number(event.target.value))}>
                {[0, 24, 36, 48, 72, 96, 144].map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? t('stamp.sizeAuto') : t('stamp.points', { value })}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={t('stamp.color')}>
              <ColorChoice value={color} onChange={setColor} />
            </Row>
          </>
        ) : (
          <>
            <Row label={t('stamp.image')}>
              <span className={styles.inline}>
                <DialogButton onClick={() => void chooseImage()} testId="watermark-image-pick">
                  {t('stamp.pickImage')}
                </DialogButton>
                <span className={styles.fileName}>{image?.name ?? t('stamp.noImage')}</span>
              </span>
            </Row>
            <Row label={t('stamp.scale', { value: scale })}>
              <input type="range" min={10} max={100} step={5} value={scale} onChange={(event) => setScale(Number(event.target.value))} />
            </Row>
          </>
        )}
        <Row label={t('stamp.opacity', { value: opacity })}>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            data-testid="watermark-opacity"
          />
        </Row>
        <Row label={t('stamp.rotation')}>
          <select className={pageStyles.select} value={rotation} onChange={(event) => setRotation(Number(event.target.value))}>
            {[0, 45, 90, -45].map((value) => (
              <option key={value} value={value}>
                {t('stamp.degrees', { value })}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('stamp.position')}>
          <span className={styles.inline}>
            <select className={pageStyles.select} value={vertical} onChange={(event) => setVertical(event.target.value as VerticalAlign)}>
              {(['top', 'middle', 'bottom'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`stamp.vertical.${value}`)}
                </option>
              ))}
            </select>
            <select className={pageStyles.select} value={horizontal} onChange={(event) => setHorizontal(event.target.value as HorizontalAlign)}>
              {(['left', 'center', 'right'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`stamp.horizontal.${value}`)}
                </option>
              ))}
            </select>
          </span>
        </Row>
        <Row label={t('stamp.layer')}>
          <select className={pageStyles.select} value={behind ? 'behind' : 'front'} onChange={(event) => setBehind(event.target.value === 'behind')}>
            <option value="front">{t('stamp.front')}</option>
            <option value="behind">{t('stamp.behind')}</option>
          </select>
        </Row>
      </div>
      {pages.field}
      <label className={pageStyles.check}>
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
        {t('stamp.replaceWatermarks')}
      </label>
    </Dialog>
  );
}

const SLOTS: Array<keyof HeaderFooterTexts> = ['headerLeft', 'headerCenter', 'headerRight', 'footerLeft', 'footerCenter', 'footerRight'];

export function HeaderFooterDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [texts, setTexts] = useState<HeaderFooterTexts>(EMPTY_TEXTS);
  const [font, setFont] = useState<TextFont>('Helvetica');
  const [size, setSize] = useState(10);
  const [color, setColor] = useState<Rgb>((COLORS[3] as { color: Rgb }).color);
  const [margins, setMargins] = useState({ top: 12, bottom: 12, left: 15, right: 15 });
  const [start, setStart] = useState(1);
  const [replace, setReplace] = useState(true);
  const pages = usePages(tab.pageCount);
  const focused = useRef<{ key: keyof HeaderFooterTexts; input: HTMLInputElement } | null>(null);
  const filled = SLOTS.some((key) => texts[key].trim() !== '');
  const ready = filled && !pages.invalid && Number.isInteger(start) && start >= 0;

  // Platzhalter an der Schreibmarke des zuletzt benutzten Feldes einfügen
  const insert = (token: string) => {
    const target = focused.current ?? { key: 'footerCenter' as const, input: null };
    const current = texts[target.key];
    const at = target.input?.selectionStart ?? current.length;
    const end = target.input?.selectionEnd ?? at;
    setTexts({ ...texts, [target.key]: current.slice(0, at) + token + current.slice(end) });
    requestAnimationFrame(() => {
      target.input?.focus();
      target.input?.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const submit = () => {
    if (!ready) return;
    void runStamp(tab, {
      type: 'addHeaderFooter',
      replace,
      spec: {
        texts,
        font,
        size,
        color,
        margins: { top: mmToPt(margins.top), bottom: mmToPt(margins.bottom), left: mmToPt(margins.left), right: mmToPt(margins.right) },
        startNumber: start,
        pages: pages.pages,
        date: today(),
        fileName: tab.name,
      },
    });
  };

  return (
    <Dialog
      title={t('stamp.headerFooterTitle')}
      onClose={close}
      onSubmit={submit}
      width={560}
      testId="header-footer-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('stamp.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!ready} testId="stamp-ok">
            {t('stamp.add')}
          </DialogButton>
        </>
      }
    >
      <div className={styles.slots}>
        {SLOTS.map((key, index) => (
          <label key={key} className={fieldStyles.field}>
            <span>{t(`stamp.slots.${key}`)}</span>
            <input
              className={fieldStyles.input}
              value={texts[key]}
              autoFocus={index === 4}
              onFocus={(event) => {
                focused.current = { key, input: event.currentTarget };
              }}
              onChange={(event) => setTexts({ ...texts, [key]: event.target.value })}
              data-testid={`hf-${key}`}
            />
          </label>
        ))}
      </div>
      <div className={styles.tokens}>
        <span>{t('stamp.insert')}</span>
        {(Object.keys(STAMP_TOKENS) as Array<keyof typeof STAMP_TOKENS>).map((token) => (
          <button
            key={token}
            type="button"
            className={styles.token}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(STAMP_TOKENS[token])}
            data-testid={`hf-token-${token}`}
          >
            {t(`stamp.tokens.${token}`)}
          </button>
        ))}
      </div>
      <div className={styles.grid}>
        <Row label={t('stamp.font')}>
          <span className={styles.inline}>
            <FontSelect value={font} onChange={setFont} />
            <select className={pageStyles.select} value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label={t('stamp.size')}>
              {[7, 8, 9, 10, 11, 12, 14, 16].map((value) => (
                <option key={value} value={value}>
                  {t('stamp.points', { value })}
                </option>
              ))}
            </select>
          </span>
        </Row>
        <Row label={t('stamp.color')}>
          <ColorChoice value={color} onChange={setColor} />
        </Row>
        <Row label={t('stamp.margins')}>
          <span className={styles.inline}>
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <input
                key={side}
                type="number"
                min={0}
                max={100}
                className={`${fieldStyles.input} ${styles.number}`}
                value={margins[side]}
                data-tooltip={t(`stamp.side.${side}`)}
                aria-label={t(`stamp.side.${side}`)}
                onChange={(event) => setMargins({ ...margins, [side]: Math.max(0, Number(event.target.value) || 0) })}
              />
            ))}
          </span>
        </Row>
        <Row label={t('stamp.startNumber')}>
          <input
            type="number"
            min={0}
            className={`${fieldStyles.input} ${styles.number}`}
            value={start}
            onChange={(event) => setStart(Math.floor(Number(event.target.value)))}
            data-testid="stamp-start"
          />
        </Row>
      </div>
      {pages.field}
      <label className={pageStyles.check}>
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
        {t('stamp.replaceHeaderFooter')}
      </label>
    </Dialog>
  );
}

const POSITIONS: PageNumberPosition[] = ['footerCenter', 'footerRight', 'footerLeft', 'headerCenter', 'headerRight', 'headerLeft'];

export function PageNumbersDialog({ tab }: { tab: TabState }) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<PageNumberPosition>('footerCenter');
  const [format, setFormat] = useState<PageNumberFormat>('pageOf');
  const [size, setSize] = useState(10);
  const [start, setStart] = useState(1);
  const [replace, setReplace] = useState(true);
  const pages = usePages(tab.pageCount);
  const labels = { page: t('stamp.pageWord'), of: t('stamp.ofWord') };
  const ready = !pages.invalid && Number.isInteger(start) && start >= 0;

  const submit = () => {
    if (!ready) return;
    void runStamp(tab, {
      type: 'addHeaderFooter',
      replace,
      spec: {
        texts: { ...EMPTY_TEXTS, [position]: pageNumberText(format, labels) },
        font: 'Helvetica',
        size,
        color: { r: 0, g: 0, b: 0 },
        margins: { top: mmToPt(12), bottom: mmToPt(12), left: mmToPt(15), right: mmToPt(15) },
        startNumber: start,
        pages: pages.pages,
        date: today(),
        fileName: tab.name,
      },
    });
  };

  const sample = (value: PageNumberFormat) =>
    pageNumberText(value, labels).split(STAMP_TOKENS.page).join(String(start)).split(STAMP_TOKENS.pages).join(String(start + tab.pageCount - 1));

  return (
    <Dialog
      title={t('stamp.pageNumbersTitle')}
      onClose={close}
      onSubmit={submit}
      width={440}
      testId="page-numbers-dialog"
      actions={
        <>
          <DialogButton onClick={close}>{t('stamp.cancel')}</DialogButton>
          <DialogButton type="submit" primary disabled={!ready} testId="stamp-ok">
            {t('stamp.add')}
          </DialogButton>
        </>
      }
    >
      <div className={styles.grid}>
        <Row label={t('stamp.position')}>
          <select
            className={pageStyles.select}
            value={position}
            onChange={(event) => setPosition(event.target.value as PageNumberPosition)}
            data-testid="page-number-position"
          >
            {POSITIONS.map((value) => (
              <option key={value} value={value}>
                {t(`stamp.slots.${value}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('stamp.format')}>
          <select
            className={pageStyles.select}
            value={format}
            onChange={(event) => setFormat(event.target.value as PageNumberFormat)}
            data-testid="page-number-format"
          >
            {PAGE_NUMBER_FORMATS.map((value) => (
              <option key={value} value={value}>
                {sample(value)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('stamp.size')}>
          <select className={pageStyles.select} value={size} onChange={(event) => setSize(Number(event.target.value))}>
            {[8, 9, 10, 11, 12, 14].map((value) => (
              <option key={value} value={value}>
                {t('stamp.points', { value })}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t('stamp.startNumber')}>
          <input
            type="number"
            min={0}
            className={`${fieldStyles.input} ${styles.number}`}
            value={start}
            onChange={(event) => setStart(Math.floor(Number(event.target.value)))}
            data-testid="stamp-start"
          />
        </Row>
      </div>
      {pages.field}
      <label className={pageStyles.check}>
        <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
        {t('stamp.replaceHeaderFooter')}
      </label>
    </Dialog>
  );
}
