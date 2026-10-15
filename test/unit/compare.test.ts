import { describe, expect, it } from 'vitest';
import { diffWords } from '../../src/shared/compare';

const words = (text: string) => text.split(' ').filter(Boolean);

describe('Wortvergleich', () => {
  it('findet eingefügte, entfernte und geänderte Wörter', () => {
    const a = words('Der schnelle braune Fuchs springt über den Hund');
    const b = words('Der braune Fuchs springt elegant über den faulen Hund');
    const diff = diffWords(a, b);
    expect(diff.removed.map((i) => a[i])).toEqual(['schnelle']);
    expect(diff.added.map((i) => b[i])).toEqual(['elegant', 'faulen']);
  });

  it('gleiche Texte ohne Unterschiede, leere Seiten', () => {
    expect(diffWords(words('a b c'), words('a b c'))).toEqual({ removed: [], added: [] });
    expect(diffWords([], words('neu hier'))).toEqual({ removed: [], added: [0, 1] });
    expect(diffWords(words('weg'), [])).toEqual({ removed: [0], added: [] });
  });

  it('Austausch eines Wortes', () => {
    const diff = diffWords(words('Preis 100 Euro'), words('Preis 120 Euro'));
    expect(diff).toEqual({ removed: [1], added: [1] });
  });

  it('begrenzt die Rechenzeit bei völlig verschiedenen langen Texten', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const diff = diffWords(a, b, 100);
    expect(diff.removed).toHaveLength(3000);
    expect(diff.added).toHaveLength(3000);
  });
});
