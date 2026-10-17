import { describe, expect, it } from 'vitest';
import { boundsAtPoint, CASCADE_OFFSET, cascadeFrom, dropTarget, fitInto } from '../../src/main/window-layout';

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

describe('Lage neuer Fenster', () => {
  it('setzt ein weiteres Fenster versetzt zum vorderen', () => {
    const front = { x: 100, y: 80, width: 900, height: 600 };
    expect(cascadeFrom(front, workArea)).toEqual({ x: 100 + CASCADE_OFFSET, y: 80 + CASCADE_OFFSET, width: 900, height: 600 });
  });

  it('beginnt die Treppe oben links neu, wenn rechts oder unten kein Platz ist', () => {
    const front = { x: 500, y: 280, width: 900, height: 600 };
    expect(cascadeFrom(front, workArea)).toEqual({ x: CASCADE_OFFSET, y: 25 + CASCADE_OFFSET, width: 900, height: 600 });
  });

  it('hält Fenster im Arbeitsbereich und verkleinert zu große', () => {
    expect(fitInto({ x: -200, y: 0, width: 2000, height: 600 }, workArea)).toEqual({ x: 0, y: 25, width: 1440, height: 600 });
  });

  it('legt das Fenster eines herausgezogenen Tabs unter den Zeiger', () => {
    const bounds = boundsAtPoint({ width: 900, height: 600 }, { x: 600, y: 300 }, workArea);
    expect(bounds.x).toBeLessThan(600);
    expect(bounds.y).toBeLessThan(300);
    expect(bounds.x + bounds.width).toBeGreaterThan(600);
  });
});

describe('Ziel eines losgelassenen Tabs', () => {
  const source = { id: 'a', bounds: { x: 0, y: 0, width: 800, height: 600 } };
  const right = { id: 'b', bounds: { x: 820, y: 0, width: 600, height: 600 } };
  const behind = { id: 'c', bounds: { x: 100, y: 100, width: 800, height: 600 } };

  it('über einem anderen Fenster: dorthin', () => {
    expect(dropTarget({ x: 900, y: 50 }, source, [right, behind])).toEqual({ kind: 'window', id: 'b' });
  });

  it('im eigenen Fenster: neues Fenster, auch wenn dahinter ein anderes liegt', () => {
    expect(dropTarget({ x: 400, y: 300 }, source, [behind])).toEqual({ kind: 'new' });
  });

  it('bei überlappenden Fenstern gewinnt das vordere', () => {
    const front = { id: 'd', bounds: { x: 850, y: 0, width: 300, height: 300 } };
    expect(dropTarget({ x: 900, y: 50 }, source, [front, right])).toEqual({ kind: 'window', id: 'd' });
  });

  it('auf freier Fläche: neues Fenster', () => {
    expect(dropTarget({ x: 1500, y: 800 }, source, [right])).toEqual({ kind: 'new' });
  });
});
