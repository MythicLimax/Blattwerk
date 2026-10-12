import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, resolveAppPath } from '../../src/main/protocol-paths';
import { readChunked } from '../../src/renderer/engine/file-reader';
import { parsePageNumber } from '../../src/renderer/features/goto/page-number';
import {
  deniedPermissions,
  describePageSize,
  formatFileSize,
  parsePdfDate,
} from '../../src/renderer/features/properties/properties';
import { layoutForMode, isPagedMode } from '../../src/renderer/features/viewer/view-modes';
import {
  clampScale,
  parsePercentInput,
  PinchAccumulator,
  wheelZoomIntent,
} from '../../src/renderer/features/viewer/zoom';
import { matchRendererShortcut } from '../../src/shared/shortcuts';

describe('resolveAppPath', () => {
  const root = path.resolve('/app/out/renderer');
  it('löst gültige Pfade auf', () => {
    expect(resolveAppPath(root, 'app://bundle/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://bundle/assets/a.js')).toBe(path.join(root, 'assets/a.js'));
    expect(resolveAppPath(root, 'app://bundle/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap')).toBe(
      path.join(root, 'pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap'),
    );
  });
  it('verhindert Ausbrüche aus dem App-Ordner', () => {
    expect(resolveAppPath(root, 'app://bundle/../../etc/passwd')).toBe(path.join(root, 'etc/passwd'));
    // Kodierte Schrägstriche überstehen das URL-Parsing und würden nach dem Dekodieren aus dem Ordner führen.
    expect(resolveAppPath(root, 'app://bundle/..%2F..%2Fetc%2Fpasswd')).toBeNull();
    expect(resolveAppPath(root, 'app://bundle/..%5C..%5Cetc')).toBe(
      path.sep === '\\' ? null : path.join(root, '..\\..\\etc'),
    );
    expect(resolveAppPath(root, 'app://bundle/a%00b')).toBeNull();
    expect(resolveAppPath(root, 'app://anderer-host/index.html')).toBeNull();
    expect(resolveAppPath(root, 'https://bundle/index.html')).toBeNull();
    expect(resolveAppPath(root, 'kein url')).toBeNull();
  });
  it('CSP verbietet fremde Skripte und eval', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/[^-]'unsafe-eval'/);
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
});

describe('readChunked', () => {
  it('teilt große Bereiche auf und setzt sie richtig zusammen', async () => {
    const source = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    const calls: Array<[number, number]> = [];
    const read = async (b: number, e: number) => {
      calls.push([b, e]);
      return source.slice(b, e);
    };
    const result = await readChunked(read, 100, 950, 300);
    expect(calls).toEqual([
      [100, 400],
      [400, 700],
      [700, 950],
    ]);
    expect(result).toEqual(source.slice(100, 950));
  });
});

describe('Zoom', () => {
  it('liest Prozenteingaben', () => {
    expect(parsePercentInput('150')).toBe(1.5);
    expect(parsePercentInput('150 %')).toBe(1.5);
    expect(parsePercentInput('87,5')).toBe(0.875);
    expect(parsePercentInput('abc')).toBeNull();
    expect(parsePercentInput('0')).toBeNull();
    expect(parsePercentInput('99999')).toBe(25);
  });
  it('begrenzt den Maßstab', () => {
    expect(clampScale(0.01)).toBe(0.1);
    expect(clampScale(100)).toBe(25);
  });
  it('sammelt kleine Pinch-Schritte, bis sie sichtbar werden', () => {
    const pinch = new PinchAccumulator();
    expect(pinch.add(1, 1.002)).toBeNull();
    expect(pinch.add(1, 1.002)).toBeNull();
    const applied = pinch.add(1, 1.002);
    expect(applied).not.toBeNull();
    expect(applied as number).toBeCloseTo(1.002 ** 3, 6);
  });
  it('unterscheidet Trackpad und Mausrad', () => {
    expect(wheelZoomIntent({ deltaY: -3, deltaMode: 0 })).toMatchObject({ kind: 'factor' });
    expect(wheelZoomIntent({ deltaY: -100, deltaMode: 0 })).toEqual({ kind: 'steps', steps: 1 });
    expect(wheelZoomIntent({ deltaY: 3, deltaMode: 1 })).toEqual({ kind: 'steps', steps: -1 });
  });
});

describe('Seitenanzeige', () => {
  it('bildet Acrobat-Ansichten auf pdf.js ab', () => {
    expect(layoutForMode('single')).toEqual({ scrollMode: 3, spreadMode: 0 });
    expect(layoutForMode('continuous')).toEqual({ scrollMode: 0, spreadMode: 0 });
    expect(layoutForMode('two-page')).toEqual({ scrollMode: 3, spreadMode: 1 });
    expect(layoutForMode('two-page-continuous')).toEqual({ scrollMode: 0, spreadMode: 1 });
    expect(isPagedMode('single')).toBe(true);
    expect(isPagedMode('continuous')).toBe(false);
  });
});

describe('Seitenzahl-Eingabe', () => {
  it('prüft den Bereich', () => {
    expect(parsePageNumber('5', 12)).toBe(5);
    expect(parsePageNumber(' 12 ', 12)).toBe(12);
    expect(parsePageNumber('13', 12)).toBeNull();
    expect(parsePageNumber('0', 12)).toBeNull();
    expect(parsePageNumber('3a', 12)).toBeNull();
  });
});

describe('Dokumenteigenschaften', () => {
  it('erkennt Papierformate', () => {
    expect(describePageSize(595.28, 841.89)).toMatchObject({ name: 'A4', orientation: 'portrait', width: '210', height: '297' });
    expect(describePageSize(792, 612)).toMatchObject({ name: 'Letter', orientation: 'landscape' });
    expect(describePageSize(500, 500).name).toBeNull();
  });
  it('formatiert Dateigrößen deutsch', () => {
    expect(formatFileSize(512)).toEqual({ size: '512 Byte', bytes: '512' });
    expect(formatFileSize(15515).size).toBe('15,2 KB');
    expect(formatFileSize(119251881)).toEqual({ size: '113,7 MB', bytes: '119.251.881' });
  });
  it('liest PDF-Datumsangaben', () => {
    expect(parsePdfDate("D:20260115093000Z")?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    expect(parsePdfDate("D:20260115103000+01'00'")?.toISOString()).toBe('2026-01-15T09:30:00.000Z');
    expect(parsePdfDate('D:2026')?.getFullYear()).toBe(2026);
    expect(parsePdfDate('D:20261345')).toBeNull();
    expect(parsePdfDate(undefined)).toBeNull();
  });
  it('listet verbotene Rechte', () => {
    expect(deniedPermissions(null)).toEqual([]);
    expect(deniedPermissions(new Set([4, 8, 32, 256, 1024]))).toEqual(['copy']);
  });
});

describe('Tastenkürzel im Renderer', () => {
  const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  it('ordnet Pfeile, Pos1 und Ende den Seitenbefehlen zu', () => {
    expect(matchRendererShortcut(key('ArrowRight'))).toBe('nav.nextPage');
    expect(matchRendererShortcut(key('ArrowLeft'))).toBe('nav.previousPage');
    expect(matchRendererShortcut(key('Home'))).toBe('nav.firstPage');
    expect(matchRendererShortcut(key('End'))).toBe('nav.lastPage');
    expect(matchRendererShortcut(key('ArrowRight', { shiftKey: true }))).toBeNull();
    expect(matchRendererShortcut(key('x'))).toBeNull();
  });
});

describe('Suchausschnitte', () => {
  it('zählt Positionen ohne Zeilenenden, merkt sich aber deren Stellen', async () => {
    const { joinTextItems } = await import('../../src/renderer/features/search/snippet');
    expect(joinTextItems([{ str: 'Hallo', hasEOL: true }, { str: 'Welt' }, {}, { str: '!' }])).toEqual({
      text: 'HalloWelt!',
      breaks: [5],
    });
  });
  it('markiert genau den Treffer und zeigt Zeilenenden als Leerzeichen', async () => {
    const { joinTextItems, snippetAround } = await import('../../src/renderer/features/search/snippet');
    const page = joinTextItems([
      { str: 'Seite 2', hasEOL: true },
      { str: `${'a'.repeat(60)} Ende`, hasEOL: true },
      { str: 'Hier steht die Suchprobe Nummer 1', hasEOL: true },
      { str: 'b'.repeat(60) },
    ]);
    const start = page.text.indexOf('Suchprobe');
    const snippet = snippetAround(page, start, 'Suchprobe'.length, 20);
    expect(snippet?.match).toBe('Suchprobe');
    expect(snippet?.before).toBe('…Ende Hier steht die ');
    expect(snippet?.after.startsWith(' Nummer 1 bbb')).toBe(true);
    expect(snippet?.after.endsWith('…')).toBe(true);
    expect(snippetAround(page, page.text.length, 5)).toBeNull();
  });
});
