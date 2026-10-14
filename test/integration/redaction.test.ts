// Schwärzen (Phase 5): Prüft, dass markierte Inhalte wirklich aus der Datei verschwinden, nicht nur überdeckt werden.
// Geprüft wird jede Stelle, an der sich Inhalt in einer PDF-Datei verstecken kann, in allen üblichen Kodierungen.
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { decodePDFRawStream, degrees, PDFDict, PDFDocument, PDFName, type PDFNumber, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Annotation, Rect } from '../../src/shared/annotations';
import type { RedactionArea } from '../../src/shared/redaction';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { redactDocument } from '../../src/workers/pdfium/redaction';
import { fixture } from '../fixtures/expectations';
import { AREAS, buildRedactionPdf, containsSecret, GLYPH_RECT, IMAGE_RECT, PUBLIC, SECRETS } from '../fixtures/redaction';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

let m: WrappedPdfiumModule;
let engine: PdfiumEngine;
const none = { upserts: [], deletions: [] };

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const areas: RedactionArea[] = [{ pageIndex: 0, rects: AREAS, quads: [] }];

async function pdfjsView(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const texts: string[] = [];
  const annotations: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    texts.push((await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '));
    for (const a of (await page.getAnnotations()) as Array<{ subtype: string; contents?: string; url?: string; fieldValue?: unknown }>) {
      annotations.push(JSON.stringify(a));
    }
  }
  const fields = (await pdf.getFieldObjects()) as unknown as Map<string, unknown> | null;
  const metadata = await pdf.getMetadata();
  await task.destroy();
  return { texts, annotations, fields: [...(fields?.keys() ?? [])], info: JSON.stringify(metadata.info), xmp: metadata.metadata?.getRaw() ?? '' };
}

// Alle Objekte der Datei, Ströme entpackt
async function decodedObjects(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const out: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) {
      let decoded: string;
      try {
        decoded = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
      } catch {
        decoded = Buffer.from(object.contents).toString('latin1');
      }
      out.push(object.dict.toString() + decoded);
    } else {
      out.push(object.toString());
    }
  }
  return out;
}

// Pixel eines Bildes (RGB), das auf einer Seite liegt
async function imagePixel(bytes: Uint8Array, pageIndex: number, x: number, y: number): Promise<number[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const xobjects = doc.getPage(pageIndex).node.Resources()?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) throw new Error('keine XObjects');
  for (const [, ref] of xobjects.entries()) {
    const image = doc.context.lookup(ref as never);
    if (!(image instanceof PDFRawStream) || image.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
    const width = (image.dict.get(PDFName.of('Width')) as PDFNumber).asNumber();
    const data = decodePDFRawStream(image).decode();
    const offset = (y * width + x) * 3;
    return Array.from(data.slice(offset, offset + 3));
  }
  throw new Error('kein Bild');
}

// Seite mit PDFium rendern und Farbe an einem Punkt (PDF-Koordinaten) lesen
function renderedPixel(bytes: Uint8Array, pageIndex: number, x: number, y: number): number[] {
  const ptr = m.pdfium.wasmExports.malloc(bytes.length);
  m.pdfium.HEAPU8.set(bytes, ptr);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  const page = m.FPDF_LoadPage(doc, pageIndex);
  const width = 596;
  const height = 842;
  const bitmap = m.FPDFBitmap_Create(width, height, 0);
  m.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
  m.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0);
  const buffer = m.FPDFBitmap_GetBuffer(bitmap);
  const stride = m.FPDFBitmap_GetStride(bitmap);
  const offset = buffer + Math.round(height - y) * stride + Math.round(x) * 4;
  const [b, g, r] = Array.from(m.pdfium.HEAPU8.slice(offset, offset + 3));
  m.FPDFBitmap_Destroy(bitmap);
  m.FPDF_ClosePage(page);
  m.FPDF_CloseDocument(doc);
  m.pdfium.wasmExports.free(ptr);
  return [r ?? 0, g ?? 0, b ?? 0];
}

const center = ([l, b, r, t]: Rect): [number, number] => [(l + r) / 2, (b + t) / 2];

describe('Schwärzen', () => {
  it('Testdatei enthält die Geheimnisse an allen Stellen (Gegenprobe)', async () => {
    const original = await buildRedactionPdf();
    const view = await pdfjsView(original);
    expect(view.texts[0]).toContain(SECRETS.text);
    expect(view.texts[0]).toContain(SECRETS.stream);
    expect(view.texts[0]).toContain(SECRETS.form);
    expect(view.fields).toContain('notiz');
    expect(view.info).toContain(SECRETS.title);
    const objects = (await decodedObjects(original)).join('\n');
    for (const secret of Object.values(SECRETS)) expect(containsSecret(objects, secret), secret).toBe(true);
    expect((await PDFDocument.load(original)).getPage(0).node.has(PDFName.of('Thumb'))).toBe(true);
  });

  it('entfernt Text, Bildinhalt, Vektorgrafik, Links, Felder, Kommentare und Metadaten endgültig', async () => {
    const original = await buildRedactionPdf();
    const output = await redactDocument(engine, original, null, none, [], areas, { removeMetadata: true });

    // 1. Keine Spur in der Datei, weder roh noch in entpackten Strömen, in keiner Kodierung
    const raw = Buffer.from(output);
    const objects = (await decodedObjects(output)).join('\n');
    for (const secret of Object.values(SECRETS)) {
      expect(containsSecret(raw, secret), `roh: ${secret}`).toBe(false);
      expect(containsSecret(objects, secret), `entpackt: ${secret}`).toBe(false);
    }

    // 2. Vollständig neu geschrieben: nur ein Stand, keine Verweise auf frühere Querverweistabellen
    expect(raw.toString('latin1').match(/%%EOF/g)).toHaveLength(1);
    expect(raw.toString('latin1')).not.toMatch(/\/Prev\s/);

    // 3. Anzeige: geheimer Text weg, öffentlicher Text und Notiz bleiben, Feld und Metadaten weg
    const view = await pdfjsView(output);
    for (const secret of Object.values(SECRETS)) {
      expect(view.texts.join(' ')).not.toContain(secret);
      expect(view.annotations.join(' ')).not.toContain(secret);
    }
    expect(view.texts[0]).toContain(PUBLIC.heading);
    expect(view.texts[0]).toContain(PUBLIC.line);
    expect(view.texts[1]).toContain(PUBLIC.page2);
    expect(view.annotations.join(' ')).toContain(PUBLIC.note);
    expect(view.annotations).toHaveLength(1);
    expect(view.fields).not.toContain('notiz');
    expect(view.info).not.toContain(SECRETS.title);
    expect(view.xmp).toBe('');

    // 4. Bild: auf Seite 1 links überschrieben, rechts erhalten; auf Seite 2 (dasselbe Bild) unverändert
    expect(await imagePixel(output, 0, 10, 10)).not.toEqual([220, 30, 30]);
    expect(await imagePixel(output, 0, 300, 10)).toEqual([30, 170, 60]);
    expect(await imagePixel(output, 1, 10, 10)).toEqual([220, 30, 30]);

    // 5. Schwarze Rechtecke an den Stellen, Inhalt außerhalb unverändert
    for (const area of AREAS) expect(renderedPixel(output, 0, ...center(area))).toEqual([0, 0, 0]);
    expect(renderedPixel(output, 0, ...center(GLYPH_RECT))).toEqual([0, 0, 0]);
    const [, ib, ir, it] = IMAGE_RECT;
    expect(renderedPixel(output, 1, ir - 20, it - 20)).not.toEqual([0, 0, 0]);
    expect(renderedPixel(output, 0, ir - 20, (ib + it) / 2)).not.toEqual([0, 0, 0]);

    // 6. Andere Programme öffnen das Ergebnis; kein Vorschaubild mit dem alten Inhalt
    expect(engine.canOpen(output, null)).toBe(true);
    const reloaded = await PDFDocument.load(output, { updateMetadata: false });
    expect(reloaded.getPages().some((page) => page.node.has(PDFName.of('Thumb')))).toBe(false);
  });

  it('kleine Vektorformen im Bereich verschwinden aus der Seite', async () => {
    const output = await redactDocument(engine, await buildRedactionPdf(), null, none, [], areas, { removeMetadata: true });
    const ptr = m.pdfium.wasmExports.malloc(output.length);
    m.pdfium.HEAPU8.set(output, ptr);
    const doc = m.FPDF_LoadMemDocument(ptr, output.length, '');
    const page = m.FPDF_LoadPage(doc, 0);
    const inside: Rect[] = [];
    for (let i = 0; i < m.FPDFPage_CountObjects(page); i++) {
      const object = m.FPDFPage_GetObject(page, i);
      const bounds = m.pdfium.wasmExports.malloc(16);
      m.FPDFPageObj_GetBounds(object, bounds, bounds + 4, bounds + 8, bounds + 12);
      const rect = [0, 4, 8, 12].map((o) => m.pdfium.getValue(bounds + o, 'float') as number) as Rect;
      m.pdfium.wasmExports.free(bounds);
      const [gl, gb, gr, gt] = GLYPH_RECT;
      if (rect[0] >= gl - 1 && rect[1] >= gb - 1 && rect[2] <= gr + 1 && rect[3] <= gt + 1) inside.push(rect);
    }
    m.FPDF_ClosePage(page);
    m.FPDF_CloseDocument(doc);
    m.pdfium.wasmExports.free(ptr);
    expect(inside).toEqual([]);
  });

  it('behält Metadaten, wenn das nicht gewünscht ist', async () => {
    const output = await redactDocument(engine, await buildRedactionPdf(), null, none, [], areas, { removeMetadata: false });
    const view = await pdfjsView(output);
    expect(view.info).toContain(SECRETS.title);
    expect(view.texts[0]).not.toContain(SECRETS.text);
  });

  it('Schwärzen über markiertem Text (Vierecke) entfernt nur diese Zeile', async () => {
    const original = await buildRedactionPdf();
    // Viereck um die Zeile mit SECRETS.text (y 690, Schriftgröße 12)
    const quad = [
      { x: 50, y: 704 },
      { x: 260, y: 704 },
      { x: 50, y: 686 },
      { x: 260, y: 686 },
    ] as RedactionArea['quads'][number];
    const output = await redactDocument(engine, original, null, none, [], [{ pageIndex: 0, rects: [], quads: [quad] }], { removeMetadata: false });
    const view = await pdfjsView(output);
    expect(view.texts[0]).not.toContain(SECRETS.text);
    expect(view.texts[0]).toContain(SECRETS.stream);
    expect(view.texts[0]).toContain(PUBLIC.line);
  });

  it('entfernt auch ältere Stände der Datei (früher gelöschte Inhalte)', async () => {
    const original = await buildRedactionPdf();
    const old = 'GEHEIM-ALTER-STAND-6666';
    // Kommentar anlegen und in einem späteren Stand wieder löschen: Er steckt dann noch im älteren Teil der Datei.
    const comment: Annotation = {
      id: 'alt',
      ref: null,
      pageIndex: 1,
      kind: 'note',
      icon: 'Comment',
      rect: [300, 300, 320, 320],
      color: { r: 1, g: 1, b: 0 },
      opacity: 1,
      contents: old,
      author: 'Test',
      created: '',
      modified: '',
      replies: [],
      statuses: [],
    };
    const withComment = engine.applyAndSave(original, null, { upserts: [{ annotation: comment, appearance: true }], deletions: [] }, { incremental: true });
    const task = pdfjs.getDocument({ data: withComment.slice(), verbosity: 0 });
    const ref = ((await (await (await task.promise).getPage(2)).getAnnotations()) as Array<{ id: string; subtype: string }>).find((a) => a.subtype === 'Text')?.id;
    await task.destroy();
    const deleted = engine.applyAndSave(withComment, null, { upserts: [], deletions: [ref ?? ''] }, { incremental: true });
    expect(containsSecret(Buffer.from(deleted), old)).toBe(true);
    const output = await redactDocument(engine, deleted, null, none, [], areas, { removeMetadata: false });
    expect(containsSecret(Buffer.from(output), old)).toBe(false);
    expect(containsSecret((await decodedObjects(output)).join(' '), old)).toBe(false);
  });

  it('Markierungen aus der Datei (z. B. Acrobat) werden mit genauer Zeilenlage angewendet', async () => {
    // Zwei Vierecke auf zwei Zeilen; ihr umgebendes Rechteck würde auch „Kontonummer“ treffen.
    const q = (l: number, b: number, r: number, t: number) => [
      { x: l, y: t },
      { x: r, y: t },
      { x: l, y: b },
      { x: r, y: b },
    ] as RedactionArea['quads'][number];
    // „Kontonummer “ ist in Helvetica 12 pt etwa 78,7 pt breit (ab x = 56); das Geheimnis beginnt bei x ≈ 134,7.
    const quads = [q(133, 686, 260, 704), q(50, 666, 100, 684)];
    const mark: Annotation = {
      id: 'mark',
      ref: null,
      pageIndex: 0,
      kind: 'redact',
      rect: [50, 666, 260, 704],
      quads,
      color: { r: 1, g: 0, b: 0 },
      opacity: 1,
      contents: '',
      author: 'Test',
      created: '',
      modified: '',
      replies: [],
      statuses: [],
    };
    const withMark = engine.applyAndSave(await buildRedactionPdf(), null, { upserts: [{ annotation: mark, appearance: true }], deletions: [] }, { incremental: true });
    // Die App schickt für unveränderte Markierungen aus der Datei nur die Seite.
    const output = await redactDocument(engine, withMark, null, none, [], [{ pageIndex: 0, rects: [], quads: [] }], { removeMetadata: false });
    const view = await pdfjsView(output);
    expect(view.texts[0]).not.toContain(SECRETS.text);
    expect(view.texts[0]).toContain('Kontonummer');
    // Zweite Zeile: nur der Anfang lag im Viereck
    expect(view.texts[0]).not.toContain('GEHEIM-STROM');
    expect(view.texts[0]).toContain('-STROM-0815');
    expect(view.annotations.join(' ')).not.toContain('Redact');
  });

  it('getaggter Ersatztext, Inline-Bilder und gedrehte Seiten', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 400]);
    const context = doc.context;
    const name = page.node.newFontDictionary('F', font.ref).asString();
    // Ersatztext für Vorlesehilfen im Inhaltsstrom und ein Bild direkt im Inhalt (BI … EI)
    const content = [
      `/Span <</ActualText (GEHEIM-ACTUAL) /MCID 0>> BDC BT ${name} 12 Tf 50 300 Td (sichtbar) Tj ET EMC`,
      'q 20 0 0 20 50 200 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID \xff\x00\x00\xff\x00\x00\xff\x00\x00\xff\x00\x00 EI Q',
      `BT ${name} 12 Tf 200 300 Td (OEFFENTLICH) Tj ET`,
    ].join('\n');
    page.node.addContentStream(context.register(context.stream(content)));
    const rotated = doc.addPage([400, 300]);
    rotated.setRotation(degrees(90));
    rotated.drawText('GEHEIM-GEDREHT', { x: 50, y: 150, size: 12, font });
    const bytes = await doc.save({ useObjectStreams: false });
    const output = await redactDocument(
      engine,
      bytes,
      null,
      none,
      [],
      [
        { pageIndex: 0, rects: [[40, 190, 120, 320]], quads: [] },
        { pageIndex: 1, rects: [[40, 140, 200, 170]], quads: [] },
      ],
      { removeMetadata: true },
    );
    const objects = [Buffer.from(output).toString('latin1'), ...(await decodedObjects(output))].join('\n');
    for (const secret of ['GEHEIM-ACTUAL', 'GEHEIM-GEDREHT', 'sichtbar']) expect(containsSecret(objects, secret), secret).toBe(false);
    expect(objects).not.toMatch(/\bBI\b[\s\S]{0,40}\bID\b/);
    expect(containsSecret(objects, 'OEFFENTLICH')).toBe(true);
  });

  it('verweigert verschlüsselte Dokumente', async () => {
    const encrypted = new Uint8Array(readFileSync(fixture('verschluesselt.pdf')));
    await expect(redactDocument(engine, encrypted, 'geheim', none, [], areas, { removeMetadata: true })).rejects.toMatchObject({ code: 'redact-encrypted' });
  });
});
