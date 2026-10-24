import { describe, expect, it } from 'vitest';
import { boldLines, linesFromBlocks } from '../../src/shared/ocr';

describe('Zeilen aus der Texterkennung', () => {
  it('fasst Wörter einer Zeile zusammen, ohne unsichere Wörter; Grundlinie und Größe aus der Zeile', () => {
    const word = (text: string, x0: number, x1: number, confidence = 90) => ({ text, confidence, bbox: { x0, y0: 100, x1, y1: 130 } });
    const blocks = [
      {
        paragraphs: [
          {
            lines: [
              { baseline: { x0: 0, y0: 124, x1: 400, y1: 124 }, bbox: { x0: 10, y0: 100, x1: 300, y1: 130 }, words: [word('Huellas', 10, 120), word('~', 125, 130, 5), word('de', 140, 170)] },
              { baseline: { x0: 0, y0: 200, x1: 400, y1: 200 }, bbox: { x0: 10, y0: 180, x1: 300, y1: 205 }, words: [word('#', 10, 20, 10)] },
            ],
          },
        ],
      },
    ];
    const lines = linesFromBlocks(blocks);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ text: 'Huellas de', box: [10, 100, 170, 130], baseline: 124 });
    expect(lines[0]?.size).toBeCloseTo(32, 0);
  });
});

describe('Fettdruck erkannter Zeilen', () => {
  it('vergleicht die Strichstärke mit den anderen Zeilen desselben Bildes', () => {
    // Unscharfer Scan: alle Striche breit, nur die Überschrift deutlich breiter
    expect(boldLines([0.2, 0.12, 0.125, 0.118, 0.13])).toEqual([true, false, false, false, false]);
    expect(boldLines([0.12, 0.125, 0.118])).toEqual([false, false, false]);
    // Wenige Zeilen: fester Wert
    expect(boldLines([0.2, 0.09])).toEqual([true, false]);
  });
});
