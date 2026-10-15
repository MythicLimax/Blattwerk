// PDF verkleinern (Phase 6): große Bilder werden verkleinert und neu kodiert, das Aussehen bleibt, Masken und geteilte
// Bilder bleiben richtig. JPEG über jpeg-js (im Programm übernimmt das der Browser).
import { init } from '@embedpdf/pdfium';
import { concatTransformationMatrix, drawObject, PDFDocument, PDFName, type PDFNumber, PDFRawStream, popGraphicsState, pushGraphicsState } from '@cantoo/pdf-lib';
import jpeg from 'jpeg-js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { downsample, unpredictPng } from '../../src/shared/compress';
import { compressDocument, type ImageCodec } from '../../src/workers/pdfium/compress';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture, imageFixture, PASSWORDS } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
let engine: PdfiumEngine;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const codec: ImageCodec = {
  decodeJpeg: async (bytes) => {
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
  },
  encodeJpeg: async (image, quality) => new Uint8Array(jpeg.encode({ width: image.width, height: image.height, data: image.rgba }, Math.round(quality * 100)).data),
};

// Weicher Farbverlauf mit etwas Struktur, wie ein Foto oder Scan
function photo(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x / width) * 255;
      rgba[i + 1] = (y / height) * 255;
      rgba[i + 2] = 128 + 60 * Math.sin(x / 40) * Math.cos(y / 50);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

async function photoPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Großes JPEG (hohe Qualität, 3000 × 2000), auf zwei Seiten verwendet
  const big = jpeg.encode({ width: 3000, height: 2000, data: photo(3000, 2000) }, 95).data;
  const shared = await doc.embedJpg(big);
  // Ungepacktes RGB-Bild (Flate), wie aus manchen Scannern
  const rgb = photo(1600, 1200);
  const samples = new Uint8Array(1600 * 1200 * 3);
  for (let i = 0; i < 1600 * 1200; i++) samples.set(rgb.subarray(i * 4, i * 4 + 3), i * 3);
  const raw = doc.context.register(
    doc.context.flateStream(samples, { Type: 'XObject', Subtype: 'Image', Width: 1600, Height: 1200, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }),
  );
  const transparent = await doc.embedPng(readFileSync(imageFixture('transparent.png')));
  for (let n = 0; n < 2; n++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(shared, { x: 20, y: 400, width: 555, height: 370 });
    page.drawText(`Seite ${n + 1} mit Text`, { x: 40, y: 800, size: 14 });
    page.drawImage(transparent, { x: 40, y: 40, width: 200, height: 100 });
    if (n === 0) {
      page.node.setXObject(PDFName.of('Raw'), raw);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(400, 0, 0, 300, 100, 50), drawObject('Raw'), popGraphicsState());
    }
  }
  return doc.save({ useObjectStreams: false });
}

// Mittlere Farbe eines Bereichs der gerenderten Seite
function average(bytes: Uint8Array, page: number, [x0, y0, x1, y1]: [number, number, number, number]): number[] {
  const { id } = engine.sessions.open(bytes, null);
  try {
    const image = engine.sessions.render(id, page, 36, 1e8);
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = Math.round(y0 * image.height); y < Math.round(y1 * image.height); y++) {
      for (let x = Math.round(x0 * image.width); x < Math.round(x1 * image.width); x++) {
        const i = (y * image.width + x) * 4;
        for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (image.rgba[i + c] as number);
        n++;
      }
    }
    return sum.map((value) => Math.round(value / n));
  } finally {
    engine.sessions.close(id);
  }
}

function images(bytes: Uint8Array) {
  return PDFDocument.load(bytes).then((doc) =>
    doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'))
      .map((object) => ({
        width: (object.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(),
        filter: object.dict.get(PDFName.of('Filter'))?.toString(),
        smask: object.dict.has(PDFName.of('SMask')),
      })),
  );
}

describe('Komprimieren', () => {
  it('verkleinert große Bilder, das Aussehen bleibt', async () => {
    const original = await photoPdf();
    const { bytes, images: count } = await compressDocument(original, 'medium', codec);
    expect(count).toBe(2);
    expect(bytes.length).toBeLessThan(original.length * 0.4);
    // 150 dpi auf A4: höchstens 1754 Bildpunkte an der langen Seite
    const list = await images(bytes);
    expect(list.filter((image) => image.width > 1754)).toEqual([]);
    expect(list.filter((image) => image.filter === '/DCTDecode')).toHaveLength(2);
    // Transparentes Bild: Maske bleibt
    expect(list.some((image) => image.smask)).toBe(true);
    // Aussehen: mittlere Farben der Bildbereiche fast gleich, Text bleibt
    for (const area of [[0.1, 0.1, 0.9, 0.5], [0.2, 0.62, 0.8, 0.9]] as Array<[number, number, number, number]>) {
      const before = average(original, 0, area);
      const after = average(bytes, 0, area);
      for (let c = 0; c < 3; c++) expect(Math.abs((before[c] ?? 0) - (after[c] ?? 0))).toBeLessThan(6);
    }
    const { id } = engine.sessions.open(bytes, null);
    expect(engine.sessions.text(id, 1)).toContain('Seite 2 mit Text');
    engine.sessions.close(id);
    expect(engine.canOpen(bytes, null)).toBe(true);
  });

  it('stärkere Stufe ergibt kleinere Dateien', async () => {
    const original = await photoPdf();
    const light = (await compressDocument(original, 'light', codec)).bytes.length;
    const strong = (await compressDocument(original, 'strong', codec)).bytes.length;
    expect(strong).toBeLessThan(light);
  });

  it('Dokumente ohne große Bilder bleiben unverändert lesbar', async () => {
    const original = new Uint8Array(readFileSync(fixture('text.pdf')));
    const { bytes, images: count } = await compressDocument(original, 'strong', codec);
    expect(count).toBe(0);
    const { id, pageCount } = engine.sessions.open(bytes, null);
    expect(pageCount).toBe(12);
    expect(engine.sessions.text(id, 0)).toContain('Testdokument mit Text');
    engine.sessions.close(id);
  });

  it('lehnt verschlüsselte Dokumente ab', async () => {
    await expect(compressDocument(new Uint8Array(readFileSync(fixture('verschluesselt.pdf'))), 'medium', codec)).rejects.toThrow('verschlüsselt');
    expect(PASSWORDS.user).toBeTruthy();
  });

  it('Hilfen: Mitteln beim Verkleinern, PNG-Prädiktoren', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 50, 50, 50, 255]);
    expect([...downsample(rgba, 2, 2, 1, 1)]).toEqual([88, 88, 88, 255]);
    // Zeile 1 „Sub“ (1), Zeile 2 „Up“ (2), je 2 Pixel mit 1 Kanal
    expect([...(unpredictPng(new Uint8Array([1, 10, 5, 2, 1, 1]), 2, 1) ?? [])]).toEqual([10, 15, 11, 16]);
    expect(unpredictPng(new Uint8Array([9, 0, 0]), 2, 1)).toBeNull();
  });
});
