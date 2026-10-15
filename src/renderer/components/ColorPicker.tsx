import { Palette, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Rgb } from '../../shared/annotations';
import { MAX_FAVORITES, sameColor, useColorFavorites, type FavoriteSet } from '../state/color-favorites';
import { GLASS, useLiquidGlass } from './glass/liquid-glass';
import styles from './ColorPicker.module.css';

export const toCss = ({ r, g, b }: Rgb) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
export const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

export function fromHex(value: string): Rgb | null {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!match) return null;
  const hex = (match[1] as string).length === 3 ? [...(match[1] as string)].map((c) => c + c).join('') : (match[1] as string);
  const n = Number.parseInt(hex, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

// Palette: eine Graureihe, darunter 12 Farbtöne in 7 Helligkeiten (hell oben, dunkel unten)
const HUES = [0, 22, 40, 52, 85, 130, 165, 190, 212, 235, 270, 320];
const LIGHTNESS = [0.88, 0.76, 0.64, 0.52, 0.42, 0.32, 0.22];
export const PALETTE: Rgb[][] = [
  Array.from({ length: 12 }, (_, i) => {
    const v = 1 - i / 11;
    return { r: v, g: v, b: v };
  }),
  ...LIGHTNESS.map((l) => HUES.map((h) => fromHsl(h, 0.72, l))),
];

// Elemente der Farbauswahl gehören zur Leiste: Klicks dort beenden eine Texteingabe nicht
export const COLOR_PANEL_SELECTOR = '[data-color-panel]';

interface ColorPickerProps {
  value: Rgb | null;
  onChange: (color: Rgb) => void;
  // Beschriftung der Vorgabefarben (Kennung → Name)
  nameOf: (id: string) => string;
  label: string;
  testId: string;
  // Welche Favoriten (Text oder Kommentare)
  favoriteSet: FavoriteSet;
}

// Lieblingsfarben als Knöpfe in der Leiste, dazu ein Knopf für die große Farbauswahl (Palette, eigene Farbe, Favoriten)
export function ColorPicker({ value, onChange, nameOf, label, testId, favoriteSet }: ColorPickerProps) {
  const { t } = useTranslation();
  const favorites = useColorFavorites((s) => s.favorites[favoriteSet]);
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (open) {
      setOpen(null);
      return;
    }
    const box = buttonRef.current?.getBoundingClientRect();
    if (box) setOpen({ left: Math.max(8, Math.min(box.left - 140, window.innerWidth - 340)), top: box.bottom + 8 });
  };

  return (
    <div className={styles.row} role="radiogroup" aria-label={label}>
      {favorites.map((favorite, i) => {
        const name = favorite.id ? nameOf(favorite.id) : toHex(favorite.color).toUpperCase();
        return (
          <button
            key={toHex(favorite.color)}
            type="button"
            role="radio"
            aria-checked={sameColor(value, favorite.color)}
            className={styles.swatch}
            style={{ background: toCss(favorite.color) }}
            data-tooltip={name}
            aria-label={name}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(favorite.color)}
            data-testid={`${testId}-${favorite.id ?? `fav-${i}`}`}
          />
        );
      })}
      <button
        ref={buttonRef}
        type="button"
        className={styles.more}
        aria-label={t('colors.more')}
        aria-expanded={open !== null}
        data-tooltip={t('colors.more')}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
        data-color-panel=""
        data-testid={`${testId}-more`}
      >
        <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open && createPortal(<ColorPanel at={open} value={value} onChange={onChange} onClose={() => setOpen(null)} anchor={buttonRef} testId={testId} favoriteSet={favoriteSet} />, document.body)}
    </div>
  );
}

function ColorPanel({
  at,
  value,
  onChange,
  onClose,
  anchor,
  testId,
  favoriteSet,
}: {
  at: { left: number; top: number };
  value: Rgb | null;
  onChange: (color: Rgb) => void;
  onClose: () => void;
  anchor: React.RefObject<HTMLButtonElement | null>;
  testId: string;
  favoriteSet: FavoriteSet;
}) {
  const { t } = useTranslation();
  const favorites = useColorFavorites((s) => s.favorites[favoriteSet]);
  const add = (color: Rgb) => useColorFavorites.getState().add(favoriteSet, color);
  const remove = (color: Rgb) => useColorFavorites.getState().remove(favoriteSet, color);
  const [hex, setHex] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const glassRef = useLiquidGlass<HTMLDivElement>(GLASS.small);
  const current = value ?? { r: 0, g: 0, b: 0 };
  const isFavorite = favorites.some((item) => sameColor(item.color, current));

  // Schließen: Klick daneben oder Esc
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    // Esc schließt nur die Farbauswahl, nicht zugleich das Werkzeug oder die Texteingabe
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchor]);

  const applyHex = (raw: string) => {
    const color = fromHex(raw);
    setHex(null);
    if (color) onChange(color);
  };

  return (
    <div
      ref={(element) => {
        panelRef.current = element;
        glassRef(element);
      }}
      className={styles.panel}
      style={{ left: at.left, top: at.top }}
      role="dialog"
      aria-label={t('colors.title')}
      data-color-panel=""
      data-testid={`${testId}-panel`}
    >
      <div className={styles.grid} role="radiogroup" aria-label={t('colors.palette')}>
        {PALETTE.flatMap((row, r) =>
          row.map((color, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              role="radio"
              aria-checked={sameColor(value, color)}
              className={styles.cell}
              style={{ background: toCss(color) }}
              aria-label={toHex(color).toUpperCase()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChange(color)}
              data-testid={`${testId}-palette`}
            />
          )),
        )}
      </div>

      <div className={styles.section}>
        <span className={styles.heading}>{t('colors.custom')}</span>
        <div className={styles.customRow}>
          <label className={styles.native} style={{ background: toCss(current) }} data-tooltip={t('colors.system')}>
            <input
              type="color"
              value={toHex(current)}
              aria-label={t('colors.system')}
              onChange={(event) => {
                const color = fromHex(event.target.value);
                if (color) onChange(color);
              }}
              data-testid={`${testId}-system`}
            />
          </label>
          <input
            className={styles.hex}
            value={hex ?? toHex(current).toUpperCase()}
            aria-label={t('colors.hex')}
            spellCheck={false}
            onChange={(event) => setHex(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') applyHex(event.currentTarget.value);
            }}
            onBlur={(event) => {
              if (hex !== null) applyHex(event.currentTarget.value);
            }}
            data-testid={`${testId}-hex`}
          />
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.heading}>{t('colors.favorites')}</span>
        <div className={styles.favorites}>
          {favorites.map((favorite) => (
            <span key={toHex(favorite.color)} className={styles.favorite}>
              <button
                type="button"
                className={styles.swatch}
                style={{ background: toCss(favorite.color) }}
                aria-label={toHex(favorite.color).toUpperCase()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChange(favorite.color)}
              />
              <button
                type="button"
                className={styles.remove}
                aria-label={t('colors.remove')}
                data-tooltip={t('colors.remove')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => remove(favorite.color)}
                data-testid={`${testId}-remove`}
              >
                <X size={9} strokeWidth={3} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className={styles.add}
            disabled={isFavorite || favorites.length >= MAX_FAVORITES}
            aria-label={t('colors.add')}
            data-tooltip={isFavorite ? t('colors.already') : favorites.length >= MAX_FAVORITES ? t('colors.full', { count: MAX_FAVORITES }) : t('colors.add')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(current)}
            data-testid={`${testId}-add`}
          >
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
