// PDF/A-2b (Phase 7): erzeugen und prüfen.
import { init } from '@embedpdf/pdfium';
import { type PDFArray, PDFDict, PDFDocument, PDFName, type PDFNumber, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { cffWidths } from '../../src/workers/pdfium/cff';
import { srgbProfile } from '../../src/workers/pdfium/icc';
import { checkPdfA, convertToPdfA, PdfAError, standardFor, type PdfAResources, type StandardFontName } from '../../src/workers/pdfium/pdfa';
import { fixture } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
let engine: PdfiumEngine;
let resources: PdfAResources;
const NOW = new Date('2026-10-15T10:30:00Z');

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
  resources = {
    standardFont: (name: StandardFontName) => engine.standardFontProgram(name),
    cmykProfile: new Uint8Array(readFileSync(require.resolve('pdfjs-dist/iccs/CGATS001Compat-v2-micro.icc'))),
  };
});

function qpdfCheck(bytes: Uint8Array): void {
  try {
    execFileSync('qpdf', ['--version'], { stdio: 'ignore' });
  } catch {
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    writeFileSync(path.join(dir, 'a.pdf'), bytes);
    execFileSync('qpdf', ['--check', path.join(dir, 'a.pdf')], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  await task.destroy();
  return content.items.map((item) => ('str' in item ? item.str : '')).join('');
}

describe('PDF/A', () => {
  it('ordnet Schriftnamen den Standardschriften zu', () => {
    expect(standardFor('Helvetica')).toBe('Helvetica');
    expect(standardFor('Arial,Bold')).toBe('Helvetica-Bold');
    expect(standardFor('ABCDEF+TimesNewRoman-Italic')).toBe('Times-Italic');
    expect(standardFor('Courier-BoldOblique')).toBe('Courier-BoldOblique');
    expect(standardFor('ZapfDingbats')).toBe('ZapfDingbats');
    expect(standardFor('Calibri')).toBeNull();
  });

  it('erzeugt ein gültiges sRGB-Profil', () => {
    const icc = srgbProfile();
    const view = new DataView(icc.buffer);
    expect(view.getUint32(0)).toBe(icc.length);
    expect(new TextDecoder().decode(icc.subarray(36, 40))).toBe('acsp');
    expect(new TextDecoder().decode(icc.subarray(16, 20))).toBe('RGB ');
  });

  it('meldet bei einem gewöhnlichen PDF die Abweichungen', async () => {
    const report = await checkPdfA(new Uint8Array(readFileSync(fixture('text.pdf'))));
    expect(report.declared).toBeNull();
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain('not-declared');
    expect(codes).toContain('output-intent');
    expect(codes).toContain('fonts');
  });

  for (const name of ['text.pdf', 'formular.pdf', 'kommentare.pdf']) {
    it(`wandelt ${name} in PDF/A-2b um`, async () => {
      const original = new Uint8Array(readFileSync(fixture(name)));
      const before = await pageText(original);
      const result = await convertToPdfA(original, resources, NOW, 'Blattwerk');
      const report = await checkPdfA(result.bytes);
      expect(report.declared).toEqual({ part: 2, conformance: 'B' });
      expect(report.issues).toEqual([]);
      expect(engine.canOpen(result.bytes, null)).toBe(true);
      qpdfCheck(result.bytes);
      expect(await pageText(result.bytes)).toBe(before);

      // Eingebettete Schriften: Breiten stimmen mit dem Schriftprogramm überein
      const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
      for (const [, object] of doc.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFDict) || object.get(PDFName.of('Type')) !== PDFName.of('Font')) continue;
        const descriptor = object.lookup(PDFName.of('FontDescriptor'));
        if (!(descriptor instanceof PDFDict)) continue;
        const file = descriptor.lookup(PDFName.of('FontFile3'));
        if (!(file instanceof PDFRawStream)) continue;
        const widths = cffWidths(decodePDFRawStream(file).decode());
        const array = object.lookup(PDFName.of('Widths')) as PDFArray;
        // Code 65 („A“) in WinAnsi und Standard
        if (object.get(PDFName.of('BaseFont')) !== PDFName.of('Symbol') && object.get(PDFName.of('BaseFont')) !== PDFName.of('ZapfDingbats'))
          expect((array.get(65) as PDFNumber).asNumber()).toBe(Math.round(widths.get('A') ?? -1));
      }
    });
  }

  it('lehnt nicht ersetzbare, nicht eingebettete Schriften ab', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Calibri', Encoding: 'WinAnsiEncoding' });
    page.node.setFontDictionary(PDFName.of('F9'), doc.context.register(font));
    const bytes = await doc.save();
    await expect(convertToPdfA(bytes, resources, NOW, 'Blattwerk')).rejects.toBeInstanceOf(PdfAError);
  });

  const arial = '/System/Library/Fonts/Supplemental/Arial.ttf';
  it.skipIf(!existsSync(arial))('bettet eine Schrift des Rechners für eine nicht eingebettete Schrift ein (Breiten aus dem Programm)', async () => {
    const program = new Uint8Array(readFileSync(arial));
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Calibri', Encoding: 'WinAnsiEncoding' });
    page.node.setFontDictionary(PDFName.of('F9'), doc.context.register(font));
    const bytes = await doc.save();
    const asked: string[] = [];
    const result = await convertToPdfA(bytes, { ...resources, systemFont: (name) => (asked.push(name), program) }, NOW, 'Blattwerk');
    expect(asked).toEqual(['Calibri']);
    expect(result.embeddedFonts).toEqual(['Calibri']);
    expect((await checkPdfA(result.bytes)).issues).toEqual([]);
    const converted = await PDFDocument.load(result.bytes);
    const embedded = [...converted.context.enumerateIndirectObjects()]
      .map(([, object]) => object)
      .find((object) => object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Font')) as PDFDict;
    const descriptor = embedded.lookup(PDFName.of('FontDescriptor')) as PDFDict;
    expect(descriptor.has(PDFName.of('FontFile2'))).toBe(true);
    // „A“ (Code 65) in Arial: 1366/2048 Einheiten = 667
    expect(((embedded.lookup(PDFName.of('Widths')) as PDFArray).get(65) as PDFNumber).asNumber()).toBe(667);
    expect(engine.canOpen(result.bytes, null)).toBe(true);
    qpdfCheck(result.bytes);
  });
});

describe('PDF/A mit CMYK', () => {
  it('ergänzt DefaultCMYK, wenn der Inhalt CMYK-Farben nutzt', async () => {
    const { cmyk, StandardFonts } = await import('@cantoo/pdf-lib');
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawRectangle({ x: 50, y: 50, width: 100, height: 100, color: cmyk(0, 1, 1, 0) });
    page.drawText('Druckfarbe', { x: 50, y: 300, size: 20, font, color: cmyk(1, 0, 0, 0) });
    const before = await checkPdfA(await doc.save());
    expect(before.issues.map((issue) => issue.code)).toContain('cmyk');
    const result = await convertToPdfA(await doc.save(), resources, NOW, 'Blattwerk');
    expect((await checkPdfA(result.bytes)).issues).toEqual([]);
    const converted = await PDFDocument.load(result.bytes);
    const colorSpaces = converted.getPage(0).node.Resources()?.lookup(PDFName.of('ColorSpace'));
    expect(colorSpaces instanceof PDFDict && colorSpaces.has(PDFName.of('DefaultCMYK'))).toBe(true);
    expect(engine.canOpen(result.bytes, null)).toBe(true);
  });
});
