import { describe, expect, it } from 'vitest';
import { isMixed, normalizeRuns, replaceRange, restyleRange, runsText, sameStyle, styleAt, withStyle, type TextRun } from '../../src/shared/rich-text';

const black = { r: 0, g: 0, b: 0 };
const red = { r: 1, g: 0, b: 0 };
const small = { size: 12, color: black, font: 'Helvetica' as const };
const big = { size: 24, color: black, font: 'Helvetica' as const };

describe('Text mit gemischter Gestaltung', () => {
  it('schreibt ohne Auswahl mit der Gestaltung des Zeichens davor weiter', () => {
    const runs: TextRun[] = [{ ...small, text: 'Hallo' }];
    expect(styleAt(runs, 5)?.size).toBe(12);
    const next = replaceRange(runs, 5, 5, ' Welt', styleAt(runs, 5) ?? small);
    expect(next).toEqual([{ ...small, text: 'Hallo Welt' }]);
  });

  it('neue Größe an der Einfügestelle gilt nur für das danach Geschriebene', () => {
    const runs: TextRun[] = [{ ...small, text: 'Hallo' }];
    const next = replaceRange(runs, 5, 5, ' groß', withStyle(styleAt(runs, 5) ?? small, { size: 24 }));
    expect(next.map((run) => [run.text, run.size])).toEqual([
      ['Hallo', 12],
      [' groß', 24],
    ]);
    // Weiterschreiben am Ende bleibt groß
    expect(styleAt(next, next[0]?.text.length ?? 0)?.size).toBe(12);
    expect(styleAt(next, runsText(next).length)?.size).toBe(24);
  });

  it('ändert mit Auswahl nur den ausgewählten Text', () => {
    const runs: TextRun[] = [{ ...small, text: 'eins zwei drei' }];
    const next = restyleRange(runs, 5, 9, { size: 24, color: red });
    expect(next.map((run) => [run.text, run.size, run.color.r])).toEqual([
      ['eins ', 12, 0],
      ['zwei', 24, 1],
      [' drei', 12, 0],
    ]);
    expect(isMixed(next)).toBe(true);
    // Alles ausgewählt: wieder einheitlich
    const all = restyleRange(next, 0, runsText(next).length, { size: 18, color: black });
    expect(all).toEqual([{ size: 18, color: black, font: 'Helvetica', text: 'eins zwei drei' }]);
    expect(isMixed(all)).toBe(false);
  });

  it('ersetzt und löscht über Stückgrenzen hinweg und fasst gleiche Stücke zusammen', () => {
    const runs: TextRun[] = [
      { ...small, text: 'ab' },
      { ...big, text: 'cd' },
      { ...small, text: 'ef' },
    ];
    expect(replaceRange(runs, 1, 5, '', small)).toEqual([{ ...small, text: 'af' }]);
    expect(runsText(replaceRange(runs, 2, 4, 'X', big))).toBe('abXef');
    expect(normalizeRuns([{ ...small, text: '' }, { ...small, text: 'a' }, { ...small, text: 'b' }])).toEqual([{ ...small, text: 'ab' }]);
  });

  it('vorhandene Schrift: gleich bei gleichem Schlüssel, neue Schrift ersetzt sie', () => {
    const own = { size: 12, color: black, source: 3, key: 'f0' };
    expect(sameStyle(own, { ...own, source: 7 })).toBe(true);
    expect(sameStyle(own, { ...own, key: 'f1' })).toBe(false);
    const replaced = withStyle(own, { font: 'TimesRoman' });
    expect(replaced).toEqual({ size: 12, color: black, font: 'TimesRoman' });
    // Nur Größe: die Schrift des Objekts bleibt
    expect(withStyle(own, { size: 20 })).toEqual({ ...own, size: 20 });
  });
});
