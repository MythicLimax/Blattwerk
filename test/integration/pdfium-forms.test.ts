// Prüft das Übernehmen ausgefüllter Formularwerte mit PDFium (Phase 4) gegen formular.pdf.
import { init } from '@embedpdf/pdfium';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeFormChanges, type FormFieldValue, type WidgetInfo } from '../../src/shared/forms';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { fixture } from '../fixtures/expectations';

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

async function fields(bytes: Uint8Array): Promise<Record<string, unknown>> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const pdf = await task.promise;
  const map = (await pdf.getFieldObjects()) as unknown as Map<string, Array<{ value: unknown; page: number }>> | null;
  const result: Record<string, unknown> = {};
  for (const [name, list] of map ?? []) result[name] = list.find((f) => f.page >= 0)?.value;
  await task.destroy();
  return result;
}

const form = () => new Uint8Array(readFileSync(fixture('formular.pdf')));

describe('PDFium-Engine: Formulare ausfüllen', () => {
  it('übernimmt Text, Kontrollkästchen, Optionsfeld und Auswahlliste', async () => {
    const original = form();
    const values: FormFieldValue[] = [
      { ref: '9R', pageIndex: 0, kind: 'text', text: 'Erika Müller-Lüdenscheidt' },
      { ref: '13R', pageIndex: 0, kind: 'checked', checked: true },
      { ref: '24R', pageIndex: 0, kind: 'checked', checked: true },
      { ref: '35R', pageIndex: 0, kind: 'choice', index: 2 },
    ];
    const saved = engine.process(original, null, none, [], { incremental: true }, values);
    // Inkrementell: das Original steht am Anfang
    expect(Buffer.from(saved.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(await fields(saved)).toMatchObject({
      name: 'Erika Müller-Lüdenscheidt',
      einverstanden: 'Yes',
      farbe: 'gruen',
      land: 'Schweiz',
    });

    // Danach andere Farbe wählen, Häkchen entfernen, Text leeren
    const again = engine.process(
      saved,
      null,
      none,
      [],
      { incremental: true },
      [
        { ref: '29R', pageIndex: 0, kind: 'checked', checked: true },
        { ref: '13R', pageIndex: 0, kind: 'checked', checked: false },
        { ref: '9R', pageIndex: 0, kind: 'text', text: '' },
      ],
    );
    expect(await fields(again)).toMatchObject({ name: '', einverstanden: 'Off', farbe: 'blau' });
  });

  it('meldet unbekannte Felder als Fehler', () => {
    expect(() => engine.process(form(), null, none, [], { incremental: true }, [{ ref: '999R', pageIndex: 0, kind: 'text', text: 'x' }])).toThrow(
      /nicht gefunden/,
    );
  });
});

describe('Geänderte Formularwerte erkennen', () => {
  const widgets = new Map<string, WidgetInfo>([
    ['9R', { id: '9R', page: 0, type: 'text', value: 'alt' }],
    ['13R', { id: '13R', page: 0, type: 'checkbox', value: 'Off', exportValues: 'Yes' }],
    ['19R', { id: '19R', page: 0, type: 'radiobutton', value: 'rot', exportValues: 'rot' }],
    ['24R', { id: '24R', page: 0, type: 'radiobutton', value: 'rot', exportValues: 'gruen' }],
    [
      '35R',
      {
        id: '35R',
        page: 0,
        type: 'combobox',
        value: 'Deutschland',
        items: [
          { exportValue: 'Deutschland', displayValue: 'Deutschland' },
          { exportValue: 'Schweiz', displayValue: 'Schweiz' },
        ],
      },
    ],
  ]);

  it('liefert nur echte Änderungen', () => {
    const changes = computeFormChanges(
      [
        ['9R', { value: 'neu' }],
        ['13R', { value: true }],
        ['19R', { value: false }],
        ['24R', { value: true }],
        ['35R', { value: 'Schweiz' }],
        ['pdfjs_internal_editor_blattwerk_hidden_5R', { deleted: true }],
      ],
      widgets,
    );
    expect(changes).toEqual([
      { ref: '9R', pageIndex: 0, kind: 'text', text: 'neu' },
      { ref: '13R', pageIndex: 0, kind: 'checked', checked: true },
      { ref: '24R', pageIndex: 0, kind: 'checked', checked: true },
      { ref: '35R', pageIndex: 0, kind: 'choice', index: 1 },
    ]);
  });

  it('unveränderte Werte zählen nicht', () => {
    expect(
      computeFormChanges(
        [
          ['9R', { value: 'alt' }],
          ['13R', { value: false }],
          ['19R', { value: true }],
          ['35R', { value: ['Deutschland'] }],
        ],
        widgets,
      ),
    ).toEqual([]);
  });
});
