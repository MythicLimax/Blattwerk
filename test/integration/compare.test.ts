// Zwei PDFs vergleichen (Phase 6): Wörter mit Lage aus PDFium, Unterschiede je Seite, Bericht mit pdf-lib.
import { init } from '@embedpdf/pdfium';
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompareLabels } from '../../src/shared/compare';
import { buildCompareReport } from '../../src/workers/pdfium/compare';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';

const require = createRequire(import.meta.url);
let engine: PdfiumEngine;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const LABELS: CompareLabels = {
  title: 'Vergleich',
  oldFile: 'Alt',
  newFile: 'Neu',
  summary: '{{pages}} Seiten geändert: {{removed}} Wörter entfernt, {{added}} neu',
  noChanges: 'Keine Unterschiede im Text',
  page: 'Seite',
  noPage: 'keine Seite',
  pageLine: 'Seite {{page}}: {{removed}} entfernt, {{added}} neu',
  pagesAdded: 'Seite {{page}} ist neu',
  pagesRemoved: 'Seite {{page}} fehlt',
  legend: 'Rot: entfernt, Grün: neu',
};

async function make(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((text, i) => page.drawText(text, { x: 60, y: 760 - i * 20, size: 12, font }));
  }
  return doc.save();
}

function wordsOf(bytes: Uint8Array) {
  const { id, pageCount } = engine.sessions.open(bytes, null);
  try {
    return Array.from({ length: pageCount }, (_, i) => engine.sessions.words(id, i));
  } finally {
    engine.sessions.close(id);
  }
}

describe('Vergleichen', () => {
  it('liefert Wörter mit Lage', async () => {
    const [words] = wordsOf(await make([['Der Preis beträgt 100 Euro.']]));
    expect(words?.map((word) => word.text)).toEqual(['Der', 'Preis', 'beträgt', '100', 'Euro.']);
    const [l, b, r, t] = words?.[1]?.rect ?? [0, 0, 0, 0];
    expect(l).toBeGreaterThan(60);
    expect(r).toBeGreaterThan(l);
    expect(b).toBeGreaterThan(755);
    expect(t).toBeLessThan(772);
  });

  it('findet geänderte, neue und gleiche Seiten und erstellt den Bericht', async () => {
    const oldBytes = await make([['Der Preis beträgt 100 Euro.', 'Lieferung in zwei Wochen.'], ['Unverändert bleibt diese Seite.']]);
    const newBytes = await make([['Der Preis beträgt 120 Euro.', 'Lieferung in zwei Wochen.'], ['Unverändert bleibt diese Seite.'], ['Ein neuer Anhang.']]);
    const result = await buildCompareReport({ oldBytes, newBytes, oldWords: wordsOf(oldBytes), newWords: wordsOf(newBytes), names: { old: 'angebot-1.pdf', new: 'angebot-2.pdf' }, labels: LABELS });
    expect(result.pages).toEqual([
      { oldPage: 1, newPage: 1, removed: 1, added: 1, sample: '– 100   + 120' },
      { oldPage: null, newPage: 3, removed: 0, added: 3, sample: '+ Ein neuer Anhang.' },
    ]);
    // Übersicht und zwei Vergleichsseiten
    const { id, pageCount } = engine.sessions.open(result.bytes, null);
    expect(pageCount).toBe(3);
    const summary = engine.sessions.text(id, 0);
    expect(summary).toContain('2 Seiten geändert: 1 Wörter entfernt, 4 neu');
    expect(summary).toContain('Seite 3 ist neu');
    expect(engine.sessions.text(id, 1)).toContain('120');
    engine.sessions.close(id);
  });

  it('ohne Unterschiede nur die Übersicht', async () => {
    const bytes = await make([['Gleich']]);
    const result = await buildCompareReport({ oldBytes: bytes, newBytes: bytes, oldWords: wordsOf(bytes), newWords: wordsOf(bytes), names: { old: 'a.pdf', new: 'b.pdf' }, labels: LABELS });
    expect(result.pages).toEqual([]);
    const { id, pageCount } = engine.sessions.open(result.bytes, null);
    expect(pageCount).toBe(1);
    expect(engine.sessions.text(id, 0)).toContain('Keine Unterschiede im Text');
    engine.sessions.close(id);
  });
});
