// Texterkennung (Phase 6): Scan-Seite mit PDFium zeichnen, mit tesseract.js erkennen (Deutsch und Englisch, Daten
// aus dem Paket, ohne Netz), als unsichtbare Textebene einfügen. Danach findet pdf.js den Text an der richtigen Stelle.
import { init } from '@embedpdf/pdfium';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasTextLayer, ocrText, rgbaToPgm, wordsFromBlocks, type OcrBlock } from '../../src/shared/ocr';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

let engine: PdfiumEngine;
const langDir = mkdtempSync(path.join(tmpdir(), 'blattwerk-ocr-'));

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
  for (const lang of ['deu', 'eng']) {
    const dir = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    copyFileSync(path.join(dir, '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(langDir, `${lang}.traineddata.gz`));
  }
});

afterAll(() => rmSync(langDir, { recursive: true, force: true }));

describe('Texterkennung', () => {
  it('Hilfen: Zeichen für die Standardschrift, Seiten mit Text, Graustufenbild', () => {
    expect(ocrText('ﬁnden „Größe“ 😀')).toBe('finden „Größe“');
    expect(hasTextLayer('  \n ')).toBe(false);
    expect(hasTextLayer('Dies ist eine Seite mit Text.')).toBe(true);
    const pgm = rgbaToPgm(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(new TextDecoder().decode(pgm.subarray(0, 11))).toBe('P5\n2 1\n255\n');
    expect([...pgm.subarray(11)]).toEqual([255, 0]);
  });

  it('erkennt eine gescannte Seite und legt eine durchsuchbare Textebene darüber', async () => {
    const scan = new Uint8Array(readFileSync(fixture('scan.pdf')));
    const { id } = engine.sessions.open(scan, null);
    expect(hasTextLayer(engine.sessions.text(id, 0))).toBe(false);
    const image = engine.sessions.render(id, 0, 300, 70_000_000);
    engine.sessions.close(id);

    const worker = await createWorker(['deu', 'eng'], 1, { langPath: langDir, cacheMethod: 'none', gzip: true });
    let blocks: OcrBlock[] | null;
    try {
      const result = await worker.recognize(Buffer.from(rgbaToPgm(image.rgba, image.width, image.height)), {}, { blocks: true, text: false });
      blocks = result.data.blocks as unknown as OcrBlock[];
    } finally {
      await worker.terminate();
    }
    const words = wordsFromBlocks(blocks);
    expect(words.length).toBeGreaterThan(40);
    expect(words.map((word) => word.text)).toEqual(expect.arrayContaining(['Testdokument', 'Blattwerk.', 'Umlaute']));

    const output = engine.process(scan, null, { upserts: [], deletions: [] }, [], { incremental: true }, [], [
      { type: 'ocrText', pageIndex: 0, width: image.width, height: image.height, words },
    ]);
    // pdf.js findet den Text, das Wort „Testdokument“ liegt dort, wo es im Bild steht
    const task = pdfjs.getDocument({ data: output.slice(), verbosity: 0 });
    const page = await (await task.promise).getPage(1);
    const items = (await page.getTextContent()).items.filter((item) => 'str' in item) as Array<{ str: string; transform: number[]; width: number }>;
    const all = items.map((item) => item.str).join(' ');
    expect(all).toContain('Umlaute');
    expect(all).toMatch(/Fließtext|Flie/);
    // pdf.js fasst die Wörter einer Zeile zusammen: Zeilenanfang „Dies“ liegt dort, wo er im Bild steht
    const target = words.find((word) => word.text === 'Dies');
    const item = items.find((entry) => entry.str.startsWith('Dies ist ein Testdokument'));
    if (!target || !item) throw new Error('Zeile fehlt');
    const scale = 72 / 300;
    expect(Math.abs((item.transform[4] ?? 0) - target.box[0] * scale)).toBeLessThan(2);
    expect(Math.abs((item.transform[5] ?? 0) - (841.89 - target.baseline * scale))).toBeLessThan(2);
    await task.destroy();
    // Unsichtbar: zum Bearbeiten nicht angeboten
    expect(engine.listObjects(output, null, [0])[0]?.objects.filter((object) => object.kind === 'text')).toEqual([]);
  }, 120_000);
});
