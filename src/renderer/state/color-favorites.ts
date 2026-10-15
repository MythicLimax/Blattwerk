// Lieblingsfarben (schneller Zugriff in der Leiste), getrennt für Text und Kommentare. Gespeichert im Browser-Speicher
// der App (bleibt nach einem Neustart erhalten); fehlt er, gelten die Vorgaben.
import { create } from 'zustand';
import type { Rgb } from '../../shared/annotations';

export interface FavoriteColor {
  // Vorgabefarben haben eine Kennung (Name in der Oberfläche, Test-ID), eigene nicht
  id?: string;
  color: Rgb;
}

export type FavoriteSet = 'text' | 'comment';

export const MAX_FAVORITES = 10;

const DEFAULTS: Record<FavoriteSet, FavoriteColor[]> = {
  text: [
    { id: 'black', color: { r: 0, g: 0, b: 0 } },
    { id: 'blue', color: { r: 0.15, g: 0.3, b: 0.75 } },
    { id: 'red', color: { r: 0.8, g: 0.1, b: 0.1 } },
    { id: 'gray', color: { r: 0.5, g: 0.5, b: 0.5 } },
  ],
  comment: [
    { id: 'yellow', color: { r: 1, g: 0.86, b: 0.2 } },
    { id: 'green', color: { r: 0.3, g: 0.75, b: 0.3 } },
    { id: 'blue', color: { r: 0.18, g: 0.44, b: 0.87 } },
    { id: 'red', color: { r: 0.85, g: 0.11, b: 0.11 } },
    { id: 'purple', color: { r: 0.56, g: 0.27, b: 0.68 } },
    { id: 'orange', color: { r: 1, g: 0.55, b: 0.1 } },
    { id: 'black', color: { r: 0, g: 0, b: 0 } },
  ],
};

const KEY: Record<FavoriteSet, string> = { text: 'blattwerk.colorFavorites', comment: 'blattwerk.commentColorFavorites' };

const channel = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

function load(set: FavoriteSet): FavoriteColor[] {
  try {
    const raw = localStorage.getItem(KEY[set]);
    if (!raw) return DEFAULTS[set];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULTS[set];
    return parsed
      .filter((item): item is FavoriteColor => typeof item === 'object' && item !== null && channel(item.color?.r) && channel(item.color?.g) && channel(item.color?.b))
      .slice(0, MAX_FAVORITES)
      .map((item) => ({ ...(typeof item.id === 'string' ? { id: item.id } : {}), color: { r: item.color.r, g: item.color.g, b: item.color.b } }));
  } catch {
    return DEFAULTS[set];
  }
}

function save(set: FavoriteSet, list: FavoriteColor[]): void {
  try {
    localStorage.setItem(KEY[set], JSON.stringify(list));
  } catch {
    // Speicher nicht verfügbar: gilt nur bis zum Beenden
  }
}

export const sameColor = (a: Rgb | null | undefined, b: Rgb) =>
  !!a && Math.abs(a.r - b.r) < 0.01 && Math.abs(a.g - b.g) < 0.01 && Math.abs(a.b - b.b) < 0.01;

interface ColorFavoritesState {
  favorites: Record<FavoriteSet, FavoriteColor[]>;
  add: (set: FavoriteSet, color: Rgb) => void;
  remove: (set: FavoriteSet, color: Rgb) => void;
}

export const useColorFavorites = create<ColorFavoritesState>((set, get) => ({
  favorites: { text: load('text'), comment: load('comment') },
  add: (which, color) => {
    const current = get().favorites[which];
    if (current.some((item) => sameColor(item.color, color)) || current.length >= MAX_FAVORITES) return;
    const list = [...current, { color }];
    save(which, list);
    set({ favorites: { ...get().favorites, [which]: list } });
  },
  remove: (which, color) => {
    const list = get().favorites[which].filter((item) => !sameColor(item.color, color));
    save(which, list);
    set({ favorites: { ...get().favorites, [which]: list } });
  },
}));
