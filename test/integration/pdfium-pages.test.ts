// Prüft die Seitenoperationen der PDFium-Engine (Phase 3) gegen die Test-PDFs.
// Kontrolle mit pdf.js (Seitenzahl, Reihenfolge über die Fußzeile „Seite N“, Drehung, Größe, Bilder).
import { init } from '@embedpdf/pdfium';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Annotation } from '../../src/shared/annotations';
import { imagePageLayout, readImageInfo } from '../../src/shared/image-info';
import type { ImageSource, PageOperation } from '../../src/shared/pages';
import { A4, moveTarget } from '../../src/shared/pages';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { PageOperationError } from '../../src/workers/pdfium/pages';
import { fixture, imageFixture, PASSWORDS, TEXT_PDF } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs')).href;

let engine: PdfiumEngine;
const NOW = new Date(Date.UTC(2026, 9, 12, 10, 0, 0));
const none = { upserts: [], deletions: [] };
const options = { incremental: true, now: NOW };

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const read = (file: string) => new Uint8Array(readFileSync(file));
const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;
const textPdf = () => read(fixture(TEXT_PDF.file));

async function open(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  return { pdf: await task.promise, close: () => task.destroy() };
}

// Ursprüngliche Seitennummern über die Fußzeile „Seite N“ des Text-PDFs; null für Seiten ohne Fußzeile
async function footerNumbers(bytes: Uint8Array, password?: string): Promise<Array<number | null>> {
  const { pdf, close } = await open(bytes, password);
  try {
    const result: Array<number | null> = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      const footer = content.items.map((item) => ('str' in item ? item.str : '')).find((s) => /^Seite \d+$/.test(s));
      result.push(footer ? Number(footer.slice(6)) : null);
    }
    return result;
  } finally {
    await close();
  }
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function image(name: 'foto.jpg' | 'viertel.png' | 'transparent.png', rotation: ImageSource['rotation'] = 0): ImageSource {
  const data = read(imageFixture(name));
  const info = readImageInfo(data);
  if (!info) throw new Error(`${name} nicht erkannt`);
  return { kind: info.kind, data: buffer(data), width: info.width, height: info.height, rotation };
}

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
function qpdfCheck(bytes: Uint8Array): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    const file = path.join(dir, 'pruefung.pdf');
    writeFileSync(file, bytes);
    execFileSync('qpdf', ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const run = (operations: PageOperation[], bytes = textPdf(), password: string | null = null) =>
  engine.process(bytes, password, none, operations, options);

describe('PDFium-Engine: Seiten organisieren', () => {
  it('dreht Seiten und speichert inkrementell', async () => {
    const original = textPdf();
    const saved = run([{ type: 'rotate', pages: [0, 2], delta: 90 }], original);
    expect(Buffer.from(saved.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    const again = engine.process(saved, null, none, [{ type: 'rotate', pages: [0], delta: 270 }], options);
    const { pdf, close } = await open(again);
    const rotations = await Promise.all(range(1, 4).map(async (n) => (await pdf.getPage(n)).rotate));
    expect(rotations).toEqual([0, 0, 90, 0]);
    await close();
  });

  it('löscht Seiten, aber nie alle', async () => {
    const saved = run([{ type: 'delete', pages: [3, 1] }]);
    expect(await footerNumbers(saved)).toEqual([1, 3, ...range(5, 12)]);
    expect(() => run([{ type: 'delete', pages: range(0, 11) }])).toThrow(PageOperationError);
    try {
      run([{ type: 'delete', pages: range(0, 11) }]);
    } catch (error) {
      expect((error as PageOperationError).code).toBe('all-pages');
    }
    expect(() => run([{ type: 'delete', pages: [12] }])).toThrow(/Ungültige Seiten/);
  });

  it('verschiebt Seiten an die gewünschte Stelle', async () => {
    // Seite 1 vor Seite 4 ziehen
    const first = run([{ type: 'move', pages: [0], to: moveTarget([0], 3) }]);
    expect((await footerNumbers(first)).slice(0, 5)).toEqual([2, 3, 1, 4, 5]);
    // Seiten 11 und 12 an den Anfang
    const second = run([{ type: 'move', pages: [10, 11], to: 0 }]);
    expect((await footerNumbers(second)).slice(0, 4)).toEqual([11, 12, 1, 2]);
    // Seite 2 ans Ende
    const third = run([{ type: 'move', pages: [1], to: moveTarget([1], 12) }]);
    expect((await footerNumbers(third)).slice(-2)).toEqual([12, 2]);
  });

  it('fügt leere Seiten in gewünschter Größe ein', async () => {
    const saved = run([{ type: 'insertBlank', at: 1, width: A4.height, height: A4.width, count: 2 }]);
    expect(await footerNumbers(saved)).toEqual([1, null, null, ...range(2, 12)]);
    const { pdf, close } = await open(saved);
    const viewport = (await pdf.getPage(2)).getViewport({ scale: 1 });
    expect([Math.round(viewport.width), Math.round(viewport.height)]).toEqual([842, 595]);
    await close();
  });

  it('fügt Seiten aus anderen PDFs ein, auch aus kennwortgeschützten', async () => {
    const form = read(fixture('formular.pdf'));
    const saved = run([{ type: 'insertPdf', at: 12, source: { data: buffer(form), password: null, pages: null } }]);
    const { pdf, close } = await open(saved);
    expect(pdf.numPages).toBe(13);
    const text = await (await pdf.getPage(13)).getTextContent();
    expect(text.items.some((item) => 'str' in item && item.str.includes('Anmeldeformular'))).toBe(true);
    await close();

    const encrypted = read(fixture('verschluesselt.pdf'));
    const source = { data: buffer(encrypted), password: PASSWORDS.user, pages: [2, 4] };
    const withPages = run([{ type: 'insertPdf', at: 0, source }]);
    expect((await footerNumbers(withPages)).slice(0, 3)).toEqual([3, 5, 1]);
    try {
      run([{ type: 'insertPdf', at: 0, source: { ...source, password: null } }]);
      expect.unreachable();
    } catch (error) {
      expect((error as PageOperationError).code).toBe('password');
    }
  });

  it('fügt JPEG und PNG (auch mit Transparenz) als Seiten ein; JPEG bleibt unverändert eingebettet', async () => {
    const images = [image('foto.jpg'), image('viertel.png'), image('transparent.png'), image('foto.jpg', 90)];
    const saved = run([{ type: 'insertImages', at: 1, images }]);
    const { pdf, close } = await open(saved);
    expect(pdf.numPages).toBe(16);
    const sizes: number[][] = [];
    for (const number of [2, 3, 4, 5]) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push([Math.round(viewport.width), Math.round(viewport.height)]);
      const operators = await page.getOperatorList();
      expect(operators.fnArray).toContain(pdfjs.OPS.paintImageXObject);
    }
    // Kleine Bilder in Originalgröße; EXIF 90° ergibt Hochformat
    expect(sizes).toEqual([
      [320, 240],
      [320, 240],
      [200, 100],
      [240, 320],
    ]);
    await close();
    // Das JPEG steckt mit DCTDecode (ohne Neukomprimierung) in der Datei
    const jpeg = read(imageFixture('foto.jpg'));
    expect(Buffer.from(saved).includes(Buffer.from(jpeg.subarray(0, 200)))).toBe(true);
    // Matrix der Drehung stimmt mit der Seitengröße überein
    const layout = imagePageLayout({ width: 320, height: 240, rotation: 90 });
    expect([layout.width, layout.height]).toEqual([240, 320]);
  });

  it('wendet Kommentaränderungen vor den Seitenoperationen an', async () => {
    const highlight: Annotation = {
      id: 'hl',
      ref: null,
      pageIndex: 2,
      kind: 'highlight',
      rect: [56, 700, 300, 716],
      color: { r: 1, g: 0.9, b: 0 },
      opacity: 1,
      contents: 'auf Seite 3',
      author: 'Test',
      created: '',
      modified: '',
      replies: [],
      statuses: [],
      quads: [
        [
          { x: 56, y: 716 },
          { x: 300, y: 716 },
          { x: 56, y: 700 },
          { x: 300, y: 700 },
        ],
      ],
    };
    const saved = engine.process(
      textPdf(),
      null,
      { upserts: [{ annotation: highlight, appearance: true }], deletions: [] },
      [{ type: 'delete', pages: [0] }],
      options,
    );
    const { pdf, close } = await open(saved);
    // Ehemalige Seite 3 ist jetzt Seite 2 und trägt die Hervorhebung
    const annotations = await (await pdf.getPage(2)).getAnnotations();
    expect(annotations.find((a) => a.subtype === 'Highlight')?.contentsObj?.str).toBe('auf Seite 3');
    await close();
  });

  it('setzt ein neues Dokument aus PDFs und Bildern zusammen', async () => {
    const text = textPdf();
    const composed = engine.compose([
      { type: 'pdf', source: { data: buffer(text), password: null, pages: [4, 0] } },
      { type: 'image', image: image('viertel.png') },
      { type: 'pdf', source: { data: buffer(read(fixture('formular.pdf'))), password: null, pages: null } },
    ]);
    expect(engine.canOpen(composed, null)).toBe(true);
    expect(await footerNumbers(composed)).toEqual([5, 1, null, null]);
    if (hasQpdf) qpdfCheck(composed);
    expect(() => engine.compose([])).toThrow(PageOperationError);
  });

  it('prüft fremde Dateien vor dem Einfügen', () => {
    expect(engine.inspect(textPdf(), null)).toEqual({ ok: true, pageCount: TEXT_PDF.pages });
    expect(engine.inspect(read(fixture('verschluesselt.pdf')), null)).toEqual({ ok: false, reason: 'password' });
    expect(engine.inspect(read(fixture('verschluesselt.pdf')), PASSWORDS.user)).toEqual({ ok: true, pageCount: TEXT_PDF.pages });
    expect(engine.inspect(read(fixture('kein-pdf.pdf')), null)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('bearbeitet kennwortgeschützte Dokumente, die Verschlüsselung bleibt', async () => {
    const encrypted = read(fixture('verschluesselt.pdf'));
    const saved = run([{ type: 'delete', pages: [0] }, { type: 'rotate', pages: [0], delta: 180 }], encrypted, PASSWORDS.user);
    expect(engine.canOpen(saved, null)).toBe(false);
    expect((await footerNumbers(saved, PASSWORDS.user)).slice(0, 2)).toEqual([2, 3]);
    if (hasQpdf) {
      const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
      const file = path.join(dir, 'x.pdf');
      writeFileSync(file, saved);
      execFileSync('qpdf', ['--check', `--password=${PASSWORDS.user}`, file], { stdio: 'pipe' });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
