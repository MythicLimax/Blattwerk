import { describe, expect, it } from 'vitest';
import { boundsAtPoint, CASCADE_OFFSET, cascadeFrom, dropTarget, fitInto, GHOST_PADDING, GHOST_TAB, ghostLayout } from '../../src/main/window-layout';

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

describe('Fensterlage je Dokument', () => {
  it('merkt sich die Lage, die neueste vorn, und übersteht einen Neustart', async () => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { WindowPositions, MAX_WINDOW_POSITIONS } = await import('../../src/main/files/window-positions');
    const dir = await mkdtemp(path.join(tmpdir(), 'blattwerk-test-'));
    try {
      const file = path.join(dir, 'positions.json');
      const positions = new WindowPositions(file, 'darwin');
      await positions.load();
      await positions.remember('/Docs/A.pdf', { x: 10, y: 20, width: 700, height: 500 });
      expect(positions.get('/docs/a.pdf')).toEqual({ x: 10, y: 20, width: 700, height: 500 });
      for (let i = 0; i < MAX_WINDOW_POSITIONS; i++) await positions.remember(`/Docs/${i}.pdf`, { x: i, y: 0, width: 600, height: 400 });
      expect(positions.get('/Docs/A.pdf')).toBeNull();
      const again = new WindowPositions(file, 'darwin');
      await again.load();
      expect(again.get(`/Docs/${MAX_WINDOW_POSITIONS - 1}.pdf`)?.x).toBe(MAX_WINDOW_POSITIONS - 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Vorschau beim Herausziehen eines Tabs', () => {
  it('verkleinert das Fenster mit gleichem Seitenverhältnis und hält den Tab an der gegriffenen Stelle', () => {
    const layout = ghostLayout({ width: 1200, height: 800 }, { x: 40, y: 12 });
    expect(layout.preview).toEqual({ width: 340, height: 227 });
    expect(layout.anchor).toEqual({ x: GHOST_PADDING + 40, y: GHOST_PADDING + GHOST_TAB.height / 2 });
    expect(layout.width).toBe(GHOST_PADDING * 2 + 340);
  });

  it('greift den Tab höchstens innerhalb der Kapsel', () => {
    expect(ghostLayout({ width: 800, height: 600 }, { x: 500, y: 0 }).anchor.x).toBe(GHOST_PADDING + GHOST_TAB.width - 14);
    expect(ghostLayout({ width: 800, height: 600 }, { x: -20, y: 0 }).anchor.x).toBe(GHOST_PADDING + 14);
  });
});
