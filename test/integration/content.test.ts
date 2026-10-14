// Seiteninhalt bearbeiten (Phase 5) mit PDFium: auflisten, Text und Bilder einfügen, verschieben, skalieren, löschen,
// Textzeilen ändern (mit Ersatzschrift, wenn Zeichen fehlen).
import { init } from '@embedpdf/pdfium';
import fontkit from '@cantoo/fontkit';
import { degrees, PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { editUnits, lineOf, lineText, paragraphText, missingChars, scalingAbout, translation, type ContentOperation } from '../../src/shared/content';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture, imageFixture } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

let engine: PdfiumEngine;
const none = { upserts: [], deletions: [] };

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const textPdf = () => new Uint8Array(readFileSync(fixture('text.pdf')));
const run = (bytes: Uint8Array, operations: ContentOperation[]) => engine.process(bytes, null, none, [], { incremental: true }, [], operations);

interface Item {
  str: string;
  transform: number[];
  fontName: string;
}

async function items(bytes: Uint8Array, pageNumber = 1): Promise<Item[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const page = await (await task.promise).getPage(pageNumber);
  const list = (await page.getTextContent()).items.filter((item) => 'str' in item && item.str.trim() !== '') as unknown as Item[];
  await task.destroy();
  return list;
}

describe('Inhalt bearbeiten', () => {
  async function paragraphPdf(): Promise<Uint8Array> {
    // Absatz wie aus einem Textprogramm: nummeriert, Zeilen in Stücken, letzte Zeile kurz; darunter eine Adresse
    // (schmal: bleibt einzelne Zeilen)
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page0 = doc.addPage([400, 400]);
    page0.drawText('1.', { x: 30, y: 300, size: 10, font });
    const lines = [['Dies ist ein Absatz,', 'der über mehrere'], ['Zeilen läuft und', 'am rechten Rand'], ['umbricht.']];
    lines.forEach((pieces, i) => {
      let x = 50;
      for (const piece of pieces) {
        page0.drawText(piece, { x, y: 300 - i * 14, size: 10, font });
        x += font.widthOfTextAtSize(piece, 10) + font.widthOfTextAtSize(' ', 10);
      }
    });
    ['Max Muster', 'Hauptstraße 1', '12345 Ort'].forEach((line, i) => page0.drawText(line, { x: 50, y: 200 - i * 14, size: 10, font }));
    return doc.save({ useObjectStreams: false });
  }

  it('Ligaturen in einem eigenen Schriftteil trennen die Zeile nicht', async () => {
    // Word legt „ft“, „ff“, „fl“ … oft in eine zweite Schrift gleichen Namens
    const doc = await PDFDocument.create();
    const main = await doc.embedFont(StandardFonts.Helvetica);
    const ligatures = await doc.embedFont(StandardFonts.Helvetica);
    const page0 = doc.addPage([400, 200]);
    let x = 20;
    for (const [piece, font] of [['Arbeitsau', main], ['ft', ligatures], ['räge:', main]] as const) {
      page0.drawText(piece, { x, y: 100, size: 20, font });
      x += font.widthOfTextAtSize(piece, 20);
    }
    const listing = engine.listObjects(await doc.save({ useObjectStreams: false }), null, [0])[0];
    expect(new Set(listing?.objects.map((o) => o.font)).size).toBe(2);
    expect(editUnits(listing?.objects ?? [], listing?.fonts).map((unit) => unit.text)).toEqual(['Arbeitsaufträge:']);
  });

  it('erkennt Absätze mit gewollten und automatischen Umbrüchen', async () => {
    const bytes = await paragraphPdf();
    const listing = engine.listObjects(bytes, null, [0])[0];
    const units = editUnits(listing?.objects ?? [], listing?.fonts);
    const texts = units.map((unit) => [unit.text, unit.lines?.length ?? 1]);
    expect(texts).toContainEqual(['Dies ist ein Absatz, der über mehrere Zeilen läuft und am rechten Rand umbricht.', 3]);
    for (const line of ['Max Muster', 'Hauptstraße 1', '12345 Ort']) expect(texts).toContainEqual([line, 1]);
    expect(texts).toContainEqual(['1.', 1]);
    expect(paragraphText([
      { index: 0, kind: 'text', bounds: [0, 20, 100, 30], text: 'Silben-', fontSize: 10 },
      { index: 1, kind: 'text', bounds: [0, 6, 40, 16], text: 'trennung', fontSize: 10 },
    ])).toBe('Silbentrennung');
    // Kurze Zeile mitten im Absatz: gewollter Umbruch
    expect(paragraphText([
      { index: 0, kind: 'text', bounds: [0, 34, 300, 44], text: 'Eine volle Zeile', fontSize: 10 },
      { index: 1, kind: 'text', bounds: [0, 20, 60, 30], text: 'Ende.', fontSize: 10 },
      { index: 2, kind: 'text', bounds: [0, 6, 280, 16], text: 'Neuer Gedanke', fontSize: 10 },
    ])).toBe('Eine volle Zeile Ende.\nNeuer Gedanke');
  });

  it('bricht einen geänderten Absatz in seiner Breite neu um', async () => {
    const bytes = await paragraphPdf();
    const listing = engine.listObjects(bytes, null, [0])[0];
    const paragraph = editUnits(listing?.objects ?? [], listing?.fonts).find((unit) => unit.text?.startsWith('Dies ist'));
    const text = 'Dies ist ein deutlich längerer Absatz, der nach der Änderung mehr Zeilen braucht als vorher und trotzdem links bündig bleibt.\nNeue Zeile.';
    const output = run(bytes, [{ type: 'editParagraph', pageIndex: 0, lines: paragraph?.lines ?? [], text }]);
    const list = (await items(output)).filter((item) => (item.transform[4] ?? 0) >= 49 && (item.transform[5] ?? 0) > 220);
    // Alle Zeilen links bei 50, Abstand 14, keine breiter als der alte Absatz
    const right = Math.max(...(paragraph?.lines ?? []).flat().map((i) => listing?.objects.find((o) => o.index === i)?.bounds[2] ?? 0));
    expect(list.map((item) => Math.round((item.transform[4] ?? 0)))).toEqual(list.map(() => 50));
    expect(list.map((item) => Math.round((item.transform[5] ?? 0)))).toEqual(list.map((_, i) => 300 - i * 14));
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    for (const item of list) expect(50 + font.widthOfTextAtSize(item.str, 10)).toBeLessThanOrEqual(right + 1);
    expect(list.map((item) => item.str).join(' ').replace(' Neue Zeile.', '\nNeue Zeile.')).toBe(text);
    expect(list.at(-1)?.str).toBe('Neue Zeile.');
    expect(list.length).toBeGreaterThan(3);
    // Nummer und Adresse unverändert
    const all = (await items(output)).map((item) => item.str);
    expect(all).toEqual(expect.arrayContaining(['1.', 'Max Muster', 'Hauptstraße 1', '12345 Ort']));

    // Kürzer: überzählige Zeilen verschwinden
    const short = run(bytes, [{ type: 'editParagraph', pageIndex: 0, lines: paragraph?.lines ?? [], text: 'Kurz.' }]);
    const shortList = (await items(short)).filter((item) => (item.transform[5] ?? 0) > 220 && (item.transform[4] ?? 0) >= 49);
    expect(shortList.map((item) => item.str)).toEqual(['Kurz.']);
  });


  it('fasst Textstücke einer Zeile zusammen und ändert sie als Ganzes', async () => {
    // Wie aus Textprogrammen: eine Zeile in mehreren Stücken, dazu ein fettes Wort und eine zweite Spalte
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page0 = doc.addPage([600, 300]);
    let x = 40;
    for (const piece of ['Dies ist', 'ein', 'zerstückelter', 'Satz']) {
      page0.drawText(piece, { x, y: 200, size: 12, font: regular });
      x += regular.widthOfTextAtSize(piece, 12) + 3;
    }
    page0.drawText('fett', { x: x + 1, y: 200, size: 12, font: bold });
    page0.drawText('Spalte', { x: 450, y: 200, size: 12, font: regular });
    page0.drawText('Nächste Zeile', { x: 40, y: 180, size: 12, font: regular });
    const bytes = await doc.save({ useObjectStreams: false });
    const objects = engine.listObjects(bytes, null, [0])[0]?.objects ?? [];
    // PDFium hängt Stücken mit Lücke dahinter ein erzeugtes Leerzeichen an
    const ein = objects.find((o) => o.text?.trim() === 'ein');
    const pieces = lineOf(objects, ein?.index ?? -1);
    expect(pieces.map((o) => o.text?.trim())).toEqual(['Dies ist', 'ein', 'zerstückelter', 'Satz']);
    expect(lineText(pieces)).toBe('Dies ist ein zerstückelter Satz');
    expect(lineOf(objects, objects.find((o) => o.text?.trim() === 'Spalte')?.index ?? -1)).toHaveLength(1);

    expect(editUnits(objects).map((unit) => [unit.text, unit.members.length])).toEqual([
      ['Dies ist ein zerstückelter Satz', 4],
      ['fett', 1],
      ['Spalte', 1],
      ['Nächste Zeile', 1],
    ]);

    const [anchor, ...rest] = pieces;
    const output = run(bytes, [
      { type: 'editText', pageIndex: 0, index: anchor?.index ?? -1, text: 'Ein ganz neuer Satz', merge: rest.map((o) => o.index) },
    ]);
    const list = (await items(output)).map((item) => item.str);
    expect(list).toContain('Ein ganz neuer Satz');
    for (const gone of ['Dies ist', 'ein', 'zerstückelter', 'Satz']) expect(list).not.toContain(gone);
    expect(list).toEqual(expect.arrayContaining(['fett', 'Spalte', 'Nächste Zeile']));
    const edited = (await items(output)).find((item) => item.str === 'Ein ganz neuer Satz');
    expect(edited?.transform.map(Math.round)).toEqual([12, 0, 0, 12, 40, 200]);
  });


  it('liefert die sichtbare Schriftgröße auch bei skalierter Textmatrix', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    page.node.setFontDictionary(PDFName.of('F1'), font.ref);
    const stream = 'BT /F1 1 Tf 12 0 0 12 50 700 Tm (Tm) Tj ET q 2 0 0 2 0 0 cm BT /F1 10 Tf 25 300 Td (cm) Tj ET Q BT /F1 14 Tf 50 500 Td (normal) Tj ET';
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(stream)));
    const [listing] = engine.listObjects(await doc.save(), null, [0]);
    const sizes = Object.fromEntries((listing?.objects ?? []).map((object) => [object.text, Math.round(object.visualSize ?? 0)]));
    expect(sizes).toEqual({ Tm: 12, cm: 20, normal: 14 });
  });


  it('listet Textzeilen mit Schrift, Größe und Lage', () => {
    const [page] = engine.listObjects(textPdf(), null, [0]);
    const heading = page?.objects.find((o) => o.text === 'Testdokument mit Text');
    expect(heading).toMatchObject({ kind: 'text', fontSize: 20 });
    expect(heading?.bounds.map(Math.round)).toEqual([56, 770, 274, 785]);
    expect(page?.fonts[heading?.font ?? '']).toMatchObject({ name: 'Helvetica-Bold', embedded: false, chars: null });
    const [scan] = engine.listObjects(new Uint8Array(readFileSync(fixture('scan.pdf'))), null, [0]);
    expect(scan?.objects.map((o) => o.kind)).toEqual(['image']);
  });

  it('ändert eine Zeile in der vorhandenen Schrift und lässt den übrigen Text unverändert', async () => {
    const original = textPdf();
    const [page] = engine.listObjects(original, null, [0]);
    const heading = page?.objects.find((o) => o.text === 'Testdokument mit Text');
    const output = run(original, [{ type: 'editText', pageIndex: 0, index: heading?.index ?? -1, text: 'Geänderte Überschrift – 100 €' }]);
    expect(Buffer.from(output.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    const list = await items(output);
    const edited = list.find((item) => item.str === 'Geänderte Überschrift – 100 €');
    expect(edited?.transform.map(Math.round)).toEqual([20, 0, 0, 20, 56, 770]);
    expect(list.map((item) => item.str)).toContain('Inhaltsverzeichnis');
    expect(list.map((item) => item.str)).not.toContain('Testdokument mit Text');
  });

  it('nimmt eine Ersatzschrift, wenn die eingebettete Teilschrift Zeichen nicht hat', async () => {
    // Eingebettete Schrift mit Teilschrift-Namen („ABCDEF+…“), wie sie Textprogramme schreiben
    const doc = await PDFDocument.create();
    const page0 = doc.addPage([300, 200]);
    const ttf = readFileSync(require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
    const context = doc.context;
    const fontFile = context.register(context.flateStream(ttf, { Length1: ttf.length }));
    const descriptor = context.register(
      context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+LiberationSans', Flags: 32, FontBBox: [-200, -300, 1200, 1000], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: fontFile }),
    );
    const fontRef = context.register(
      context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+LiberationSans', FirstChar: 32, LastChar: 255, Widths: Array<number>(224).fill(556), Encoding: 'WinAnsiEncoding', FontDescriptor: descriptor }),
    );
    const name = page0.node.newFontDictionary('F', fontRef).asString();
    page0.node.addContentStream(context.register(context.flateStream(`BT ${name} 18 Tf 20 100 Td (Hallo) Tj ET`)));
    const bytes = await doc.save({ useObjectStreams: false });
    const [page] = engine.listObjects(bytes, null, [0]);
    const line = page?.objects.find((o) => o.kind === 'text');
    const fontInfo = page?.fonts[line?.font ?? ''];
    // Die eingebettete Schrift ist vollständig: alle Zeichen da, keine Ersatzschrift nötig
    expect(fontInfo).toMatchObject({ name: 'LiberationSans', embedded: true });
    expect(missingChars('Hallo Welt äöü €', fontInfo)).toBe('');
    expect(missingChars('Łódź', fontInfo)).toContain('Ł');
    const output = run(bytes, [{ type: 'editText', pageIndex: 0, index: line?.index ?? -1, text: 'Hallo Welt' }]);
    const [item] = await items(output);
    expect(item?.str).toBe('Hallo Welt');
    expect(item?.transform.map(Math.round)).toEqual([18, 0, 0, 18, 20, 100]);
  });

  it('Teilschrift: vorhandene Zeichen behalten die Schrift, fehlende führen zur Ersatzschrift', async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(readFileSync(require.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')), { subset: true });
    doc.addPage([300, 200]).drawText('Hallo', { x: 20, y: 100, size: 18, font });
    const bytes = await doc.save({ useObjectStreams: false });
    const [page] = engine.listObjects(bytes, null, [0]);
    const line = page?.objects.find((o) => o.kind === 'text');
    const fontInfo = page?.fonts[line?.font ?? ''];
    expect(fontInfo?.embedded).toBe(true);
    expect(missingChars('Holla', fontInfo)).toBe('');
    expect(missingChars('Hallo Welt', fontInfo)).toBe('Wet');
    const fontOf = (bytes: Uint8Array) => {
      const [listing] = engine.listObjects(bytes, null, [0]);
      const text = listing?.objects.find((o) => o.kind === 'text');
      return listing?.fonts[text?.font ?? '']?.name;
    };
    const originalFont = fontOf(bytes);

    const same = run(bytes, [{ type: 'editText', pageIndex: 0, index: line?.index ?? -1, text: 'Holla' }]);
    expect((await items(same))[0]?.str).toBe('Holla');
    expect(fontOf(same)).toBe(originalFont);

    const substituted = run(bytes, [{ type: 'editText', pageIndex: 0, index: line?.index ?? -1, text: 'Hallo Welt' }]);
    const [item] = await items(substituted);
    expect(item?.str).toBe('Hallo Welt');
    expect(fontOf(substituted)).toBe('Helvetica');
    expect(item?.transform.map(Math.round)).toEqual([18, 0, 0, 18, 20, 100]);

    expect(() => run(bytes, [{ type: 'editText', pageIndex: 0, index: line?.index ?? -1, text: 'Łódź' }])).toThrow(/Ł/);
  });

  it('fügt mehrzeiligen Text und ein Bild ein', async () => {
    const data = readFileSync(imageFixture('viertel.png'));
    const output = run(textPdf(), [
      { type: 'addText', pageIndex: 0, origin: { x: 300, y: 300 }, lines: ['Erste Zeile', 'Zweite Zeile'], font: 'TimesRoman', size: 12, color: { r: 0, g: 0, b: 1 } },
      {
        type: 'addImage',
        pageIndex: 0,
        rect: [300, 100, 460, 220],
        image: { kind: 'png', data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), width: 320, height: 240, rotation: 0 },
      },
    ]);
    const list = await items(output);
    const first = list.find((item) => item.str === 'Erste Zeile');
    const second = list.find((item) => item.str === 'Zweite Zeile');
    expect(first?.transform.map(Math.round)).toEqual([12, 0, 0, 12, 300, 300]);
    expect(second?.transform.map((v) => Math.round(v * 10) / 10)).toEqual([12, 0, 0, 12, 300, 285.6]);
    const [page] = engine.listObjects(output, null, [0]);
    const image = page?.objects.find((o) => o.kind === 'image');
    expect(image?.bounds.map(Math.round)).toEqual([300, 100, 460, 220]);
  });

  it('Text auf gedrehten Seiten steht aufrecht zur Anzeige', async () => {
    const doc = await PDFDocument.load(textPdf(), { updateMetadata: false });
    doc.getPage(0).setRotation(degrees(90));
    const rotated = await doc.save({ useObjectStreams: false });
    const output = run(rotated, [
      { type: 'addText', pageIndex: 0, origin: { x: 100, y: 100 }, lines: ['A', 'B'], font: 'Helvetica', size: 10, color: { r: 0, g: 0, b: 0 } },
    ]);
    const task = pdfjs.getDocument({ data: output.slice(), verbosity: 0 });
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const list = (await page.getTextContent()).items as unknown as Item[];
    const view = (item: Item | undefined) => {
      const [a = 0, b = 0, , , e = 0, f = 0] = item?.transform ?? [];
      const start = viewport.convertToViewportPoint(e, f);
      const end = viewport.convertToViewportPoint(e + a, f + b);
      return { start, direction: [(end[0] ?? 0) - (start[0] ?? 0), (end[1] ?? 0) - (start[1] ?? 0)] };
    };
    const a = view(list.find((item) => item.str === 'A'));
    const b = view(list.find((item) => item.str === 'B'));
    await task.destroy();
    // Schreibrichtung in der Ansicht nach rechts, zweite Zeile darunter
    expect(a.direction[0]).toBeGreaterThan(0);
    expect(Math.abs(a.direction[1] ?? 1)).toBeLessThan(0.01);
    expect((b.start[1] ?? 0) - (a.start[1] ?? 0)).toBeCloseTo(12, 1);
  });

  it('verschiebt, skaliert und löscht Objekte', async () => {
    const original = textPdf();
    const [page] = engine.listObjects(original, null, [0]);
    const heading = page?.objects.find((o) => o.text === 'Testdokument mit Text');
    const toc = page?.objects.find((o) => o.text === 'Inhaltsverzeichnis');
    const moved = run(original, [
      { type: 'transform', pageIndex: 0, index: heading?.index ?? -1, matrix: translation(10, -20) },
      { type: 'transform', pageIndex: 0, index: toc?.index ?? -1, matrix: scalingAbout(2, 57, 520) },
    ]);
    const [after] = engine.listObjects(moved, null, [0]);
    expect(after?.objects.find((o) => o.text === 'Testdokument mit Text')?.bounds.map(Math.round)).toEqual([66, 750, 284, 765]);
    const scaled = after?.objects.find((o) => o.text === 'Inhaltsverzeichnis');
    expect(Math.round((scaled?.bounds[2] ?? 0) - (scaled?.bounds[0] ?? 0))).toBe(Math.round(2 * ((toc?.bounds[2] ?? 0) - (toc?.bounds[0] ?? 0))));
    const deleted = run(moved, [{ type: 'delete', pageIndex: 0, indices: [scaled?.index ?? -1] }]);
    expect((await items(deleted)).map((item) => item.str)).not.toContain('Inhaltsverzeichnis');
  });

  it('meldet fehlende Objekte', () => {
    expect(() => run(textPdf(), [{ type: 'delete', pageIndex: 0, indices: [999] }])).toThrow(/fehlt/);
  });
});
