// Formularfelder anlegen, ändern und löschen (Phase 4) mit pdf-lib; danach Ausfüllen mit PDFium.
import { init } from '@embedpdf/pdfium';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type PDFDict, PDFDocument, PDFHexString, PDFName, type PDFRef } from '@cantoo/pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_SETTINGS, type FieldOperation, type FieldSettings, type FormFieldValue } from '../../src/shared/forms';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { applyFieldOperations, FieldOperationError } from '../../src/workers/pdfium/fields';
import { repairComposed, repairInserted } from '../../src/workers/pdfium/imported';
import { fixture, PASSWORDS } from '../fixtures/expectations';

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

const read = (name: string) => new Uint8Array(readFileSync(fixture(name)));
const settings = (patch: Partial<FieldSettings>): FieldSettings => ({ ...DEFAULT_FIELD_SETTINGS, ...patch });

interface WidgetData {
  id: string;
  fieldName: string;
  fieldType: string;
  rect: number[];
  checkBox?: boolean;
  radioButton?: boolean;
  combo?: boolean;
  buttonValue?: string;
  options?: Array<{ exportValue: string }>;
  required: boolean;
  readOnly: boolean;
  multiLine?: boolean;
  alternativeText: string;
  fieldValue: unknown;
  hasAppearance: boolean;
  defaultAppearanceData?: { fontSize: number };
}

async function widgets(bytes: Uint8Array, pageNumber = 1): Promise<WidgetData[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const annotations = await (await pdf.getPage(pageNumber)).getAnnotations();
  await task.destroy();
  return (annotations as unknown as Array<WidgetData & { subtype: string }>).filter((a) => a.subtype === 'Widget');
}

async function values(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const map = (await pdf.getFieldObjects()) as unknown as Map<string, Array<{ value: unknown; page: number }>> | null;
  const result: Record<string, unknown> = {};
  for (const [name, list] of map ?? []) result[name] = list.find((f) => f.page >= 0)?.value;
  await task.destroy();
  return result;
}

const hasQpdf = spawnSync('qpdf', ['--version']).status === 0;
function qpdfCheck(bytes: Uint8Array): void {
  if (!hasQpdf) return;
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    const file = path.join(dir, 'pruefung.pdf');
    writeFileSync(file, bytes);
    execFileSync('qpdf', ['--check', file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Alle Prüfungen für gespeicherte Dateien: Original unverändert vorn, PDFium, pdf-lib und qpdf öffnen sie.
async function checkOutput(original: Uint8Array, output: Uint8Array): Promise<void> {
  expect(Buffer.from(output.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
  expect(engine.canOpen(output, null)).toBe(true);
  await PDFDocument.load(output, { updateMetadata: false });
  qpdfCheck(output);
}

const create = (kind: Extract<FieldOperation, { type: 'createField' }>['kind'], rect: [number, number, number, number], patch: Partial<FieldSettings>, pageIndex = 0): FieldOperation => ({
  type: 'createField',
  pageIndex,
  rect,
  kind,
  settings: settings(patch),
});

describe('Formularfelder anlegen', () => {
  it('legt Text, Kontrollkästchen, Auswahlliste und eine Optionsgruppe an, die sich mit PDFium ausfüllen lassen', async () => {
    const original = read('text.pdf');
    const output = await applyFieldOperations(original, [
      create('text', [100, 600, 300, 622], { name: 'Vorname', tooltip: 'Ihr Vorname', required: true, fontSize: 11 }),
      create('checkbox', [100, 560, 114, 574], { name: 'Zustimmung' }),
      create('dropdown', [100, 520, 300, 542], { name: 'Stadt', options: ['Berlin', 'Köln', 'München'], editable: true }),
      create('radio', [100, 480, 114, 494], { name: 'Größe', exportValue: 'klein' }),
      create('radio', [140, 480, 154, 494], { name: 'Größe', exportValue: 'groß' }),
      create('text', [100, 400, 300, 460], { name: 'Bemerkung', multiline: true, readOnly: true }),
    ]);
    await checkOutput(original, output);

    const list = await widgets(output);
    const byName = (name: string) => list.filter((w) => w.fieldName === name);
    const [first] = byName('Vorname');
    expect(first).toMatchObject({ fieldType: 'Tx', required: true, readOnly: false, alternativeText: 'Ihr Vorname', hasAppearance: true });
    expect(first?.defaultAppearanceData?.fontSize).toBe(11);
    expect(first?.rect.map(Math.round)).toEqual([100, 600, 300, 622]);
    expect(byName('Zustimmung')[0]).toMatchObject({ fieldType: 'Btn', checkBox: true });
    expect(byName('Stadt')[0]).toMatchObject({ fieldType: 'Ch', combo: true });
    expect(byName('Stadt')[0]?.options?.map((o) => o.exportValue)).toEqual(['Berlin', 'Köln', 'München']);
    expect(byName('Größe').map((w) => w.buttonValue)).toEqual(['klein', 'groß']);
    expect(byName('Bemerkung')[0]).toMatchObject({ multiLine: true, readOnly: true });

    // Mit PDFium ausfüllen (wie die App beim Speichern)
    const id = (name: string, i = 0) => byName(name)[i]?.id ?? '';
    const filled = engine.process(output, null, none, [], { incremental: true }, [
      { ref: id('Vorname'), pageIndex: 0, kind: 'text', text: 'Jörg' },
      { ref: id('Zustimmung'), pageIndex: 0, kind: 'checked', checked: true },
      { ref: id('Stadt'), pageIndex: 0, kind: 'choice', index: 1 },
      { ref: id('Größe', 1), pageIndex: 0, kind: 'checked', checked: true },
    ] satisfies FormFieldValue[]);
    expect(await values(filled)).toMatchObject({ Vorname: 'Jörg', Zustimmung: 'Yes', Stadt: 'Köln', Größe: 'groß' });
  });

  it('fügt einer vorhandenen Optionsgruppe einen Knopf hinzu', async () => {
    const original = read('formular.pdf');
    const output = await applyFieldOperations(original, [create('radio', [340, 596, 356, 612], { name: 'farbe', exportValue: 'gelb' })]);
    await checkOutput(original, output);
    const buttons = (await widgets(output)).filter((w) => w.fieldName === 'farbe');
    expect(buttons.map((w) => w.buttonValue)).toEqual(['rot', 'gruen', 'blau', 'gelb']);
    const filled = engine.process(output, null, none, [], { incremental: true }, [
      { ref: buttons[3]?.id ?? '', pageIndex: 0, kind: 'checked', checked: true },
    ]);
    expect((await values(filled)).farbe).toBe('gelb');
  });

  it('lehnt doppelte Namen und Namen mit Punkt ab', async () => {
    const original = read('formular.pdf');
    await expect(applyFieldOperations(original, [create('text', [100, 100, 200, 120], { name: 'name' })])).rejects.toMatchObject({ code: 'field-name' });
    await expect(applyFieldOperations(original, [create('text', [100, 100, 200, 120], { name: 'a.b' })])).rejects.toMatchObject({ code: 'field-name' });
    // Ein Optionsfeld darf keiner Gruppe beitreten, die gar keine ist
    await expect(applyFieldOperations(original, [create('radio', [100, 100, 114, 114], { name: 'land', exportValue: 'x' })])).rejects.toMatchObject({
      code: 'field-name',
    });
    // Wert in der Gruppe schon vergeben
    await expect(applyFieldOperations(original, [create('radio', [100, 100, 114, 114], { name: 'farbe', exportValue: 'rot' })])).rejects.toMatchObject({
      code: 'field-name',
    });
  });

  it('verweigert verschlüsselte Dokumente', async () => {
    const error = await applyFieldOperations(read('verschluesselt.pdf'), [create('text', [100, 100, 200, 120], { name: 'x' })]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FieldOperationError);
    expect((error as FieldOperationError).code).toBe('field-encrypted');
    expect(PASSWORDS.user).toBeTruthy();
  });
});

describe('Formularfelder bearbeiten', () => {
  it('verschiebt, vergrößert, benennt um und ändert Eigenschaften', async () => {
    const original = read('formular.pdf');
    const output = await applyFieldOperations(original, [
      { type: 'updateField', ref: '9R', rect: [160, 650, 460, 690] },
      {
        type: 'updateField',
        ref: '9R',
        settings: settings({ name: 'vollerName', tooltip: 'Vor- und Nachname', required: true, multiline: true, fontSize: 14 }),
      },
      { type: 'updateField', ref: '35R', settings: settings({ name: 'land', options: ['Deutschland', 'Italien'], readOnly: true }) },
      { type: 'updateField', ref: '24R', settings: settings({ name: 'farbe', exportValue: 'grün' }) },
    ]);
    await checkOutput(original, output);
    const list = await widgets(output);
    const text = list.find((w) => w.id === '9R');
    expect(text).toMatchObject({ fieldName: 'vollerName', required: true, multiLine: true, alternativeText: 'Vor- und Nachname' });
    expect(text?.rect.map(Math.round)).toEqual([160, 650, 460, 690]);
    expect(text?.defaultAppearanceData?.fontSize).toBe(14);
    const land = list.find((w) => w.id === '35R');
    expect(land?.options?.map((o) => o.exportValue)).toEqual(['Deutschland', 'Italien']);
    expect(land?.readOnly).toBe(true);
    // Auswahl „Deutschland“ bleibt, weil der Eintrag weiter existiert
    expect((await values(output)).land).toEqual('Deutschland');
    expect(list.filter((w) => w.fieldName === 'farbe').map((w) => w.buttonValue)).toEqual(['rot', 'grün', 'blau']);
  });
});

describe('Formularfelder löschen', () => {
  it('entfernt ein Feld vollständig (Seite und Formularverzeichnis)', async () => {
    const original = read('formular.pdf');
    const output = await applyFieldOperations(original, [{ type: 'deleteField', ref: '9R' }]);
    await checkOutput(original, output);
    expect((await widgets(output)).some((w) => w.id === '9R')).toBe(false);
    expect(Object.keys(await values(output))).not.toContain('name');
    const doc = await PDFDocument.load(output, { updateMetadata: false });
    expect(doc.getForm().getFields().map((f) => f.getName())).toEqual(['einverstanden', 'farbe', 'land']);
  });

  it('entfernt einzelne Knöpfe einer Optionsgruppe, die übrigen behalten ihren Wert', async () => {
    const original = read('formular.pdf');
    // Erst Grün auswählen, dann den grünen Knopf löschen: Die Gruppe hat danach keine Auswahl mehr.
    const selected = engine.process(original, null, none, [], { incremental: true }, [{ ref: '24R', pageIndex: 0, kind: 'checked', checked: true }]);
    const output = await applyFieldOperations(selected, [{ type: 'deleteField', ref: '24R' }]);
    await checkOutput(selected, output);
    const buttons = (await widgets(output)).filter((w) => w.fieldName === 'farbe');
    expect(buttons.map((w) => w.buttonValue)).toEqual(['rot', 'blau']);
    expect((await values(output)).farbe).toBe('Off');
    const filled = engine.process(output, null, none, [], { incremental: true }, [
      { ref: buttons[1]?.id ?? '', pageIndex: 0, kind: 'checked', checked: true },
    ]);
    expect((await values(filled)).farbe).toBe('blau');

    // Alle Knöpfe löschen: Die Gruppe verschwindet ganz.
    const empty = await applyFieldOperations(output, buttons.map((w) => ({ type: 'deleteField' as const, ref: w.id })));
    expect(Object.keys(await values(empty))).not.toContain('farbe');
  });

  it('meldet unbekannte Felder', async () => {
    await expect(applyFieldOperations(read('formular.pdf'), [{ type: 'deleteField', ref: '999R' }])).rejects.toMatchObject({ code: 'field-missing' });
  });
});

describe('Übernommene Seiten (Zusammenführen, Einfügen)', () => {
  const source = (data: Uint8Array, pages: number[] | null = null) => ({
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    password: null,
    pages,
  });

  it('Zusammenführen: Felder bleiben ausfüllbar, doppelte Namen werden getrennt', async () => {
    const parts = [
      { type: 'pdf' as const, source: source(read('text.pdf'), [0]) },
      { type: 'pdf' as const, source: source(read('formular.pdf')) },
      { type: 'pdf' as const, source: source(read('formular.pdf')) },
    ];
    const composed = engine.compose(parts);
    const output = await repairComposed(composed, parts);
    await checkOutput(composed, output);
    const names = Object.keys(await values(output));
    expect(names.sort()).toEqual(['einverstanden', 'einverstanden 2', 'farbe', 'farbe 2', 'land', 'land 2', 'name', 'name 2']);
    // Optionsgruppen behalten ihre Werte; beide Kopien lassen sich unabhängig ausfüllen
    const second = await widgets(output, 3);
    expect(second.filter((w) => w.fieldName === 'farbe 2').map((w) => w.buttonValue)).toEqual(['rot', 'gruen', 'blau']);
    const first = (await widgets(output, 2)).find((w) => w.fieldName === 'name');
    const filled = engine.process(output, null, none, [], { incremental: true }, [
      { ref: first?.id ?? '', pageIndex: 1, kind: 'text', text: 'Erste' },
      { ref: second.find((w) => w.fieldName === 'name 2')?.id ?? '', pageIndex: 2, kind: 'text', text: 'Zweite' },
      { ref: second.find((w) => w.buttonValue === 'blau')?.id ?? '', pageIndex: 2, kind: 'checked', checked: true },
    ]);
    expect(await values(filled)).toMatchObject({ name: 'Erste', 'name 2': 'Zweite', 'farbe 2': 'blau' });
  });

  it('Seiten mit Formular in ein Formular einfügen', async () => {
    const original = read('formular.pdf');
    const op = { type: 'insertPdf' as const, at: 1, source: source(read('formular.pdf')) };
    const inserted = engine.process(original, null, none, [op], { incremental: true });
    const output = await repairInserted(inserted, op.source, op.at);
    await checkOutput(original, output);
    const doc = await PDFDocument.load(output, { updateMetadata: false });
    expect(doc.getForm().getFields().map((f) => f.getName())).toEqual(['name', 'einverstanden', 'farbe', 'land', 'name 2', 'einverstanden 2', 'farbe 2', 'land 2']);
  });

  it('Popups zeigen nach dem Übernehmen wieder auf ihren Kommentar', async () => {
    // Notiz mit Popup, wie Acrobat sie anlegt
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const note = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('Hallo') }));
    const popup = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [40, 40, 200, 120], Parent: note }));
    (doc.context.lookup(note) as PDFDict).set(PDFName.of('Popup'), popup);
    page.node.set(PDFName.of('Annots'), doc.context.obj([note, popup]));
    const withPopup = await doc.save({ useObjectStreams: false });
    const parts = [
      { type: 'pdf' as const, source: source(read('text.pdf'), [0]) },
      { type: 'pdf' as const, source: source(withPopup) },
    ];
    const composed = engine.compose(parts);
    const output = await repairComposed(composed, parts);
    const result = await PDFDocument.load(output, { updateMetadata: false });
    const annots = result.getPage(1).node.Annots();
    const [noteRef, popupRef] = [annots?.get(0), annots?.get(1)];
    const popupDict = result.context.lookup(popupRef as PDFRef) as PDFDict;
    expect(String(popupDict.get(PDFName.of('Parent')))).toBe(String(noteRef));
  });

  it('ohne Formular und Popups bleibt alles, wie es ist', async () => {
    const parts = [{ type: 'pdf' as const, source: source(read('text.pdf'), [0, 1]) }];
    const composed = engine.compose(parts);
    expect(await repairComposed(composed, parts)).toBe(composed);
  });
});
