// Prüft die Speicher-Engine (PDFium-WASM): Anmerkungen anlegen, ändern, löschen, inkrementell speichern.
// Kontrolle mit pdf.js (Anzeige-Engine der App) und @cantoo/pdf-lib (unabhängiger Parser für die Objektstruktur).
import { PDFArray, type PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFRef, PDFString } from '@cantoo/pdf-lib';
import { init } from '@embedpdf/pdfium';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Annotation, AnnotationChanges } from '../../src/shared/annotations';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture, PASSWORDS } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs')).href;

let engine: PdfiumEngine;

beforeAll(async () => {
  const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const NOW = new Date(Date.UTC(2026, 9, 12, 10, 0, 0));
const DATE = 'D:20261012120000+02\'00\'';
const base = {
  ref: null,
  pageIndex: 0,
  opacity: 1,
  author: 'Prüferin',
  created: DATE,
  modified: DATE,
  replies: [],
  statuses: [],
};

function sampleAnnotations(): Annotation[] {
  return [
    {
      ...base,
      id: 'hl-1',
      kind: 'highlight',
      rect: [56, 700, 300, 716],
      color: { r: 1, g: 0.9, b: 0 },
      opacity: 0.6,
      contents: 'Wichtig',
      quads: [[{ x: 56, y: 716 }, { x: 300, y: 716 }, { x: 56, y: 700 }, { x: 300, y: 700 }]],
      replies: [{ id: 'reply-1', ref: null, author: 'Lektor', contents: 'Stimmt, übernehme ich.', modified: DATE }],
      statuses: [{ id: 'status-1', ref: null, author: 'Lektor', status: 'Accepted', modified: DATE }],
    },
    {
      ...base,
      id: 'ul-1',
      kind: 'underline',
      rect: [56, 680, 200, 696],
      color: { r: 0, g: 0.4, b: 1 },
      contents: '',
      quads: [[{ x: 56, y: 696 }, { x: 200, y: 696 }, { x: 56, y: 680 }, { x: 200, y: 680 }]],
    },
    {
      ...base,
      id: 'so-1',
      kind: 'strikeout',
      rect: [56, 660, 200, 676],
      color: { r: 1, g: 0, b: 0 },
      contents: '',
      quads: [[{ x: 56, y: 676 }, { x: 200, y: 676 }, { x: 56, y: 660 }, { x: 200, y: 660 }]],
    },
    { ...base, id: 'note-1', kind: 'note', rect: [500, 760, 520, 780], color: { r: 1, g: 0.8, b: 0 }, contents: 'Bitte prüfen: äöüß', icon: 'Comment' },
    { ...base, id: 'ft-1', kind: 'freetext', rect: [300, 600, 520, 630], color: { r: 0.8, g: 0, b: 0 }, contents: 'Textfeld mit Umlauten: Größe', fontSize: 12 },
    {
      ...base,
      id: 'ink-1',
      kind: 'ink',
      rect: [100, 500, 200, 560],
      color: { r: 0, g: 0, b: 1 },
      contents: '',
      width: 2,
      paths: [[{ x: 100, y: 500 }, { x: 150, y: 560 }, { x: 200, y: 500 }]],
    },
    { ...base, id: 'sq-1', kind: 'square', rect: [250, 450, 350, 520], color: { r: 1, g: 0, b: 0 }, contents: '', width: 2, fill: null },
    { ...base, id: 'ci-1', kind: 'circle', rect: [380, 450, 480, 520], color: { r: 0, g: 0.6, b: 0 }, contents: '', width: 3, fill: { r: 0.9, g: 1, b: 0.9 } },
    { ...base, id: 'li-1', kind: 'line', rect: [95, 395, 305, 425], color: { r: 0, g: 0, b: 0 }, contents: '', width: 2, start: { x: 100, y: 400 }, end: { x: 300, y: 420 } },
    { ...base, id: 'ar-1', kind: 'arrow', rect: [95, 345, 305, 385], color: { r: 1, g: 0, b: 0 }, contents: '', width: 2, start: { x: 100, y: 350 }, end: { x: 300, y: 380 } },
    { ...base, id: 'st-1', kind: 'stamp', rect: [350, 300, 520, 350], color: { r: 0.13, g: 0.55, b: 0.13 }, contents: '', stamp: 'approved', label: 'GENEHMIGT' },
  ];
}

const allNew = (annotations: Annotation[]): AnnotationChanges => ({
  upserts: annotations.map((annotation) => ({ annotation, appearance: true })),
  deletions: [],
});

async function pdfjsAnnotations(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const pdf = await task.promise;
  const annotations = await (await pdf.getPage(1)).getAnnotations();
  await task.destroy();
  return annotations;
}

async function annotationDicts(bytes: Uint8Array, password?: string): Promise<PDFDict[]> {
  const doc = await PDFDocument.load(bytes, { password, ignoreEncryption: false } as Parameters<typeof PDFDocument.load>[1]);
  const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'));
  if (!(annots instanceof PDFArray)) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref as PDFRef) as PDFDict);
}

const subtypeOf = (dict: PDFDict) => dict.get(PDFName.of('Subtype'))?.toString();

// qpdf prüft die Dateistruktur unabhängig von PDFium und pdf.js. In CI installiert, lokal oft nicht vorhanden.
const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;

function qpdfCheck(bytes: Uint8Array, password?: string): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    const file = path.join(dir, 'pruefung.pdf');
    writeFileSync(file, bytes);
    // Wirft bei Fehlern (Exit-Code 2); Warnungen (Exit-Code 3) gelten ebenfalls als Fehler.
    execFileSync('qpdf', ['--check', ...(password ? [`--password=${password}`] : []), file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('PDFium-Engine: Kommentare speichern', () => {
  it('legt alle Kommentarsorten als echte Annotationen mit Darstellung an und speichert inkrementell', async () => {
    const original = new Uint8Array(readFileSync(fixture('text.pdf')));
    const saved = engine.applyAndSave(original, null, allNew(sampleAnnotations()), { incremental: true, now: NOW });

    // Inkrementell: Die Originaldatei steht unverändert am Anfang.
    expect(saved.length).toBeGreaterThan(original.length);
    expect(Buffer.from(saved.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(engine.canOpen(saved, null)).toBe(true);
    // Zur Sichtprüfung (z. B. mit Apple Vorschau): BLATTWERK_WRITE_SAMPLE=Pfad setzen
    if (process.env.BLATTWERK_WRITE_SAMPLE) writeFileSync(process.env.BLATTWERK_WRITE_SAMPLE, saved);

    const annotations = await pdfjsAnnotations(saved);
    const bySubtype = (subtype: string) => annotations.filter((a) => a.subtype === subtype);
    expect(bySubtype('Highlight')).toHaveLength(1);
    expect(bySubtype('Underline')).toHaveLength(1);
    expect(bySubtype('StrikeOut')).toHaveLength(1);
    expect(bySubtype('FreeText')).toHaveLength(1);
    expect(bySubtype('Ink')).toHaveLength(1);
    expect(bySubtype('Square')).toHaveLength(1);
    expect(bySubtype('Circle')).toHaveLength(1);
    expect(bySubtype('Line')).toHaveLength(2);
    expect(bySubtype('Stamp')).toHaveLength(1);

    const highlight = bySubtype('Highlight')[0];
    expect(highlight?.contentsObj?.str).toBe('Wichtig');
    expect(highlight?.titleObj?.str).toBe('Prüferin');
    expect(Array.from(highlight?.color ?? [])).toEqual([255, 230, 0]);

    const note = annotations.find((a) => a.subtype === 'Text' && !a.inReplyTo);
    expect(note?.contentsObj?.str).toBe('Bitte prüfen: äöüß');

    const reply = annotations.find((a) => a.inReplyTo && a.contentsObj?.str === 'Stimmt, übernehme ich.');
    expect(reply?.inReplyTo).toBe(highlight?.id);
    expect(reply?.replyType).toBe('R');

    const arrow = bySubtype('Line').find((a) => a.lineEndings?.[1] === 'OpenArrow');
    expect(arrow).toBeDefined();

    // Jede sichtbare Anmerkung hat einen Appearance Stream (sonst zeigt Apple Vorschau sie nicht richtig an).
    const dicts = await annotationDicts(saved);
    // Ohne die vier Links, die das Test-PDF schon enthält, und ohne Antworten/Status (versteckt, ohne Darstellung)
    const visible = dicts.filter(
      (d) => subtypeOf(d) !== '/Link' && (subtypeOf(d) !== '/Text' || !d.has(PDFName.of('IRT'))),
    );
    expect(visible.length).toBe(11);
    for (const dict of visible) {
      expect(dict.has(PDFName.of('AP')), `AP fehlt bei ${subtypeOf(dict)}`).toBe(true);
    }

    // Statuseintrag nach ISO 32000: versteckte Text-Anmerkung mit State und StateModel
    const status = dicts.find((d) => d.has(PDFName.of('State')));
    expect(status?.get(PDFName.of('StateModel'))?.toString()).toContain('Review');
  });

  it.skipIf(!hasQpdf)('gespeicherte Dateien bestehen qpdf --check', () => {
    const original = new Uint8Array(readFileSync(fixture('text.pdf')));
    qpdfCheck(engine.applyAndSave(original, null, allNew(sampleAnnotations()), { incremental: true, now: NOW }));
    const encrypted = new Uint8Array(readFileSync(fixture('verschluesselt.pdf')));
    const note = sampleAnnotations().find((a) => a.kind === 'note') as Annotation;
    qpdfCheck(engine.applyAndSave(encrypted, PASSWORDS.user, allNew([note]), { incremental: true, now: NOW }), PASSWORDS.user);
  });

  it('ändert und löscht vorhandene Anmerkungen über ihre Objektnummer', async () => {
    const original = new Uint8Array(readFileSync(fixture('text.pdf')));
    const first = engine.applyAndSave(original, null, allNew(sampleAnnotations()), { incremental: true, now: NOW });
    const existing = await pdfjsAnnotations(first);
    const square = existing.find((a) => a.subtype === 'Square');
    const ink = existing.find((a) => a.subtype === 'Ink');
    if (!square || !ink) throw new Error('Testvoraussetzung fehlt');

    const moved: Annotation = {
      ...base,
      id: 'sq-1',
      ref: square.id,
      kind: 'square',
      rect: [260, 460, 360, 530],
      color: { r: 0, g: 0, b: 1 },
      contents: 'verschoben',
      width: 4,
      fill: null,
    };
    const second = engine.applyAndSave(
      first,
      null,
      { upserts: [{ annotation: moved, appearance: true }], deletions: [ink.id] },
      { incremental: true, now: NOW },
    );
    expect(Buffer.from(second.subarray(0, first.length)).equals(Buffer.from(first))).toBe(true);

    const after = await pdfjsAnnotations(second);
    expect(after.some((a) => a.subtype === 'Ink')).toBe(false);
    const updated = after.find((a) => a.subtype === 'Square');
    expect(updated?.id).toBe(square.id);
    expect(updated?.contentsObj?.str).toBe('verschoben');
    expect(Array.from(updated?.color ?? [])).toEqual([0, 0, 255]);
    expect(updated?.rect.map(Math.round)).toEqual([260, 460, 360, 530]);
  });

  it('ersetzt formatierten Text (/RC) und behält die Merkmale vorhandener Kommentare', async () => {
    // Notiz, wie Acrobat sie anlegt: Text zusätzlich als /RC, gesperrt (Flag 128) und druckbar (4)
    const doc = await PDFDocument.load(readFileSync(fixture('text.pdf')));
    const page = doc.getPage(0);
    const ref = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [500, 760, 520, 780],
        Contents: PDFHexString.fromText('Alter Text'),
        RC: PDFString.of('<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"><p>Alter Text</p></body>'),
        F: PDFNumber.of(132),
      }),
    );
    page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
    const source = await doc.save({ useObjectStreams: false });
    const [existing] = await pdfjsAnnotations(source);
    if (!existing) throw new Error('Testvoraussetzung fehlt');

    const note: Annotation = {
      ...base,
      id: existing.id,
      ref: existing.id,
      kind: 'note',
      icon: 'Comment',
      rect: [500, 760, 520, 780],
      color: { r: 1, g: 0.8, b: 0 },
      contents: 'Neuer Text <mit> & Zeichen\nzweite Zeile',
    };
    const saved = engine.applyAndSave(source, null, { upserts: [{ annotation: note, appearance: false }], deletions: [] }, { incremental: true, now: NOW });
    const [dict] = await annotationDicts(saved);
    if (!dict) throw new Error('Anmerkung fehlt');
    const rc = dict.lookup(PDFName.of('RC'));
    const rcText = rc instanceof PDFString || rc instanceof PDFHexString ? rc.decodeText() : '';
    expect(rcText).toContain('<p>Neuer Text &lt;mit&gt; &amp; Zeichen</p><p>zweite Zeile</p>');
    expect(rcText).not.toContain('Alter Text');
    expect(dict.lookup(PDFName.of('F'))?.toString()).toBe('132');
  });

  it('speichert Kommentare in kennwortgeschützten PDFs, die Verschlüsselung bleibt erhalten', async () => {
    const original = new Uint8Array(readFileSync(fixture('verschluesselt.pdf')));
    const note = sampleAnnotations().find((a) => a.kind === 'note') as Annotation;
    const saved = engine.applyAndSave(original, PASSWORDS.user, allNew([note]), { incremental: true, now: NOW });
    expect(engine.canOpen(saved, null)).toBe(false);
    expect(engine.canOpen(saved, PASSWORDS.user)).toBe(true);
    const annotations = await pdfjsAnnotations(saved, PASSWORDS.user);
    expect(annotations.find((a) => a.subtype === 'Text')?.contentsObj?.str).toBe('Bitte prüfen: äöüß');
  });
});
