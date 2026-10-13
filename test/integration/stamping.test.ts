// Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen (Phase 5) mit pdf-lib; Darstellung geprüft mit pdf.js und PDFium.
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { degrees, PDFArray, PDFDocument, PDFName } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_TEXTS, type HeaderFooterSpec, type WatermarkSpec } from '../../src/shared/stamping';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { applyStampOperations, StampError } from '../../src/workers/pdfium/stamping';
import { fixture, imageFixture, TEXT_PDF } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

let m: WrappedPdfiumModule;
let engine: PdfiumEngine;

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const textPdf = () => new Uint8Array(readFileSync(fixture('text.pdf')));

const watermark = (patch: Partial<Extract<WatermarkSpec, { kind: 'text' }>> = {}): WatermarkSpec => ({
  kind: 'text',
  text: 'ENTWURF',
  font: 'HelveticaBold',
  size: 0,
  color: { r: 0.8, g: 0, b: 0 },
  opacity: 0.4,
  rotation: 45,
  vertical: 'middle',
  horizontal: 'center',
  behind: false,
  pages: null,
  ...patch,
});

const footer = (patch: Partial<HeaderFooterSpec> = {}): HeaderFooterSpec => ({
  texts: { ...EMPTY_TEXTS, footerCenter: 'Seite {Seite} von {Seiten}', headerLeft: '{Datei} – {Datum}' },
  font: 'Helvetica',
  size: 10,
  color: { r: 0, g: 0, b: 0 },
  margins: { top: 30, bottom: 30, left: 40, right: 40 },
  startNumber: 1,
  pages: null,
  date: '14.10.2026',
  fileName: 'bericht.pdf',
  ...patch,
});

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

async function pages(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const result: Array<{ items: TextItem[]; viewport: { width: number; height: number; convertToViewportPoint(x: number, y: number): number[] } }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const items = (await page.getTextContent()).items.filter((item) => 'str' in item) as unknown as TextItem[];
    result.push({ items, viewport: page.getViewport({ scale: 1 }) });
  }
  await task.destroy();
  return result;
}

const text = (items: TextItem[]) => items.map((item) => item.str).join(' ');

// Farbe eines Punktes der angezeigten Seite (Ansichtskoordinaten, Ursprung oben links) mit PDFium
function renderedPixel(bytes: Uint8Array, pageIndex: number, x: number, y: number): number[] {
  const ptr = m.pdfium.wasmExports.malloc(bytes.length);
  m.pdfium.HEAPU8.set(bytes, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  const page = m.FPDF_LoadPage(doc, pageIndex);
  const width = Math.round(m.FPDF_GetPageWidthF(page));
  const height = Math.round(m.FPDF_GetPageHeightF(page));
  const bitmap = m.FPDFBitmap_Create(width, height, 0);
  m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
  m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);
  const offset = m.FPDFBitmap_GetBuffer(bitmap) + Math.round(y) * m.FPDFBitmap_GetStride(bitmap) + Math.round(x) * 4;
  const [b, g, r] = Array.from(m.pdfium.HEAPU8.slice(offset, offset + 3));
  m.FPDFBitmap_Destroy(bitmap);
  m.FPDF_ClosePage(page);
  m.FPDF_CloseDocument(doc);
  m.pdfium.wasmExports.free(ptr);
  return [r ?? 0, g ?? 0, b ?? 0];
}

async function contentRefs(bytes: Uint8Array, pageIndex: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const contents = doc.getPage(pageIndex).node.get(PDFName.of('Contents'));
  return (contents instanceof PDFArray ? contents.asArray() : [contents]).map(String);
}

describe('Wasserzeichen', () => {
  it('Text auf allen Seiten, schräg und halbdurchsichtig; der vorhandene Inhalt bleibt unverändert', async () => {
    const original = textPdf();
    const output = await applyStampOperations(original, [{ type: 'addWatermark', spec: watermark(), replace: true }]);
    expect(Buffer.from(output.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(engine.canOpen(output, null)).toBe(true);
    const before = await contentRefs(original, 0);
    const after = await contentRefs(output, 0);
    for (const ref of before) expect(after).toContain(ref);
    const list = await pages(output);
    expect(list).toHaveLength(TEXT_PDF.pages);
    for (const page of list) expect(text(page.items)).toContain('ENTWURF');
    // Um die Seitenmitte: rötlich durchscheinend (weder weiß noch voll rot)
    const samples = Array.from({ length: 41 }, (_, i) => renderedPixel(output, 0, 277 + i, 401 + i));
    const tinted = samples.filter(([r = 0, g = 0, b = 0]) => r > g + 40 && g > 80 && b > 80);
    expect(tinted.length).toBeGreaterThan(0);
  });

  it('hinter dem Inhalt: eigener Strom steht vorn', async () => {
    const original = textPdf();
    const output = await applyStampOperations(original, [{ type: 'addWatermark', spec: watermark({ behind: true, pages: [0] }), replace: true }]);
    const before = await contentRefs(original, 0);
    const after = await contentRefs(output, 0);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(1)).toEqual(before);
    expect(text((await pages(output))[1]?.items ?? [])).not.toContain('ENTWURF');
  });

  it('Bild als Wasserzeichen', async () => {
    const data = readFileSync(imageFixture('viertel.png'));
    const output = await applyStampOperations(textPdf(), [
      {
        type: 'addWatermark',
        replace: true,
        spec: {
          kind: 'image',
          image: { kind: 'png', data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), width: 320, height: 240, rotation: 0 },
          scale: 50,
          opacity: 1,
          rotation: 0,
          vertical: 'middle',
          horizontal: 'center',
          behind: false,
          pages: [0],
        },
      },
    ]);
    // Bild 50 % der Seitenbreite, mittig: links oben rot, rechts unten gelb
    expect(renderedPixel(output, 0, 297 - 60, 421 - 40)).toEqual([220, 30, 30]);
    expect(renderedPixel(output, 0, 297 + 60, 421 + 40)).toEqual([240, 200, 20]);
  });

  it('entfernen nimmt genau die eigenen Ströme heraus; ersetzen statt doppeln', async () => {
    const original = textPdf();
    const once = await applyStampOperations(original, [{ type: 'addWatermark', spec: watermark(), replace: true }]);
    const twice = await applyStampOperations(once, [{ type: 'addWatermark', spec: watermark({ text: 'KOPIE' }), replace: true }]);
    const page = text((await pages(twice))[0]?.items ?? []);
    expect(page).toContain('KOPIE');
    expect(page).not.toContain('ENTWURF');
    const removed = await applyStampOperations(twice, [{ type: 'removeArtifacts', kind: 'watermark' }]);
    expect(text((await pages(removed))[0]?.items ?? [])).not.toContain('KOPIE');
    expect(await contentRefs(removed, 0)).toEqual(await contentRefs(original, 0));
    await expect(applyStampOperations(removed, [{ type: 'removeArtifacts', kind: 'watermark' }])).rejects.toMatchObject({ code: 'stamp-nothing' });
  });

  it('meldet Zeichen, die die Standardschrift nicht kennt', async () => {
    const error = await applyStampOperations(textPdf(), [{ type: 'addWatermark', spec: watermark({ text: 'Łódź' }), replace: true }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StampError);
    expect(error).toMatchObject({ code: 'stamp-characters' });
    expect((error as StampError).message).toContain('Ł');
  });

  it('verweigert verschlüsselte Dokumente', async () => {
    await expect(
      applyStampOperations(new Uint8Array(readFileSync(fixture('verschluesselt.pdf'))), [{ type: 'addWatermark', spec: watermark(), replace: true }]),
    ).rejects.toMatchObject({ code: 'stamp-encrypted' });
  });
});

describe('Kopf- und Fußzeilen, Seitenzahlen', () => {
  it('Platzhalter, Ausrichtung und Abstand vom Rand', async () => {
    const output = await applyStampOperations(textPdf(), [{ type: 'addHeaderFooter', spec: footer(), replace: true }]);
    const list = await pages(output);
    list.forEach((page, index) => {
      const footerItem = page.items.find((item) => item.str === `Seite ${index + 1} von ${TEXT_PDF.pages}`);
      expect(footerItem, `Seite ${index + 1}`).toBeDefined();
      const [x = 0, y = 0] = footerItem?.transform.slice(4) ?? [];
      expect(y).toBeCloseTo(30, 0);
      expect(x + (footerItem?.width ?? 0) / 2).toBeCloseTo(page.viewport.width / 2, 0);
      expect(text(page.items)).toContain('bericht.pdf – 14.10.2026');
    });
  });

  it('Seitenbereich mit eigener Startnummer', async () => {
    const output = await applyStampOperations(textPdf(), [{ type: 'addHeaderFooter', spec: footer({ pages: [2, 3, 4], startNumber: 1 }), replace: true }]);
    const list = await pages(output);
    expect(text(list[1]?.items ?? [])).not.toContain('Seite 1 von');
    expect(text(list[2]?.items ?? [])).toContain('Seite 1 von 3');
    expect(text(list[4]?.items ?? [])).toContain('Seite 3 von 3');
  });

  it('auf gedrehten Seiten aufrecht und unten, wie angezeigt', async () => {
    const doc = await PDFDocument.load(textPdf(), { updateMetadata: false });
    doc.getPage(0).setRotation(degrees(90));
    const rotated = await doc.save({ useObjectStreams: false });
    const output = await applyStampOperations(rotated, [{ type: 'addHeaderFooter', spec: footer({ pages: [0] }), replace: true }]);
    const [page] = await pages(output);
    const item = page?.items.find((entry) => entry.str.startsWith('Seite 1 von'));
    expect(item).toBeDefined();
    const [a = 0, b = 0, , , e = 0, f = 0] = item?.transform ?? [];
    // In der Ansicht: Schreibrichtung waagerecht nach rechts, Grundlinie 30 pt über dem unteren Rand
    const start = page?.viewport.convertToViewportPoint(e, f) ?? [0, 0];
    const end = page?.viewport.convertToViewportPoint(e + a, f + b) ?? [0, 0];
    expect((end[0] ?? 0) - (start[0] ?? 0)).toBeGreaterThan(0);
    expect(Math.abs((end[1] ?? 0) - (start[1] ?? 0))).toBeLessThan(0.01);
    expect((page?.viewport.height ?? 0) - (start[1] ?? 0)).toBeCloseTo(30, 0);
  });

  it('entfernen lässt Wasserzeichen stehen', async () => {
    const both = await applyStampOperations(textPdf(), [
      { type: 'addWatermark', spec: watermark(), replace: true },
      { type: 'addHeaderFooter', spec: footer(), replace: true },
    ]);
    const removed = await applyStampOperations(both, [{ type: 'removeArtifacts', kind: 'headerFooter' }]);
    const page = text((await pages(removed))[0]?.items ?? []);
    expect(page).toContain('ENTWURF');
    expect(page).not.toContain('Seite 1 von');
  });
});
