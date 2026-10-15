// Seiten zeichnen und Text auslesen mit PDFium-Sitzungen (Phase 6: Export, Texterkennung, Vergleich).
import { init } from '@embedpdf/pdfium';
import { degrees, PDFDocument, rgb } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture, PASSWORDS } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
let engine: PdfiumEngine;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const pixel = (page: { width: number; rgba: Uint8Array }, x: number, y: number) => [...page.rgba.subarray((y * page.width + x) * 4, (y * page.width + x) * 4 + 3)];

describe('Seiten zeichnen', () => {
  it('zeichnet in der verlangten Auflösung und liest den Text', () => {
    const { id, pageCount } = engine.sessions.open(new Uint8Array(readFileSync(fixture('text.pdf'))), null);
    try {
      expect(pageCount).toBe(12);
      const page = engine.sessions.render(id, 0, 144, 70_000_000);
      expect([page.width, page.height]).toEqual([Math.round(595.28 * 2), Math.round(841.89 * 2)]);
      expect(pixel(page, 5, 5)).toEqual([255, 255, 255]);
      expect(page.rgba.some((value, i) => i % 4 === 0 && value < 100)).toBe(true);
      const text = engine.sessions.text(id, 0);
      expect(text).toContain('Testdokument mit Text');
      expect(text).toContain('Die Umlaute ä, ö und ü sowie das ß');
      expect(text.split('\n').length).toBeGreaterThan(5);
    } finally {
      engine.sessions.close(id);
    }
  });

  it('gedrehte Seiten erscheinen aufrecht, sehr große werden verkleinert', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    page.drawRectangle({ x: 0, y: 0, width: 50, height: 200, color: rgb(1, 0, 0) });
    page.setRotation(degrees(90));
    doc.addPage([14400, 14400]);
    const { id } = engine.sessions.open(await doc.save(), null);
    try {
      const rotated = engine.sessions.render(id, 0, 72, 70_000_000);
      expect([rotated.width, rotated.height]).toEqual([200, 400]);
      // Der rote Streifen links liegt nach der Drehung um 90° im Uhrzeigersinn oben
      expect(pixel(rotated, 100, 10)).toEqual([255, 0, 0]);
      expect(pixel(rotated, 100, 390)).toEqual([255, 255, 255]);
      const huge = engine.sessions.render(id, 1, 300, 4_000_000);
      expect(huge.width * huge.height).toBeLessThanOrEqual(4_000_000);
      expect(huge.dpi).toBeLessThan(300);
    } finally {
      engine.sessions.close(id);
    }
  });

  it('übernimmt ungespeicherte Kommentare und öffnet verschlüsselte Dokumente', () => {
    const bytes = new Uint8Array(readFileSync(fixture('verschluesselt.pdf')));
    const { id, pageCount } = engine.openSession(bytes, PASSWORDS.user, { upserts: [], deletions: [] }, []);
    expect(pageCount).toBe(12);
    expect(engine.sessions.text(id, 0)).toContain('Testdokument');
    engine.sessions.close(id);
    expect(() => engine.sessions.text(id, 0)).toThrow('Sitzung beendet');
  });
});
