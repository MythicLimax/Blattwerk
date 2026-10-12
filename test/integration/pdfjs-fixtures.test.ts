// Prüft die Test-PDFs mit derselben pdf.js-Version, die die App verwendet (Node-Variante).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it } from 'vitest';
import { createRangeTransport, RANGE_CHUNK_SIZE } from '../../src/renderer/engine/range-transport';
import { fixture, LARGE_PDF, PASSWORDS, TEXT_PDF } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfjsRoot, 'legacy/build/pdf.worker.mjs')).href;

const commonOptions = {
  standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
  cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep,
  wasmUrl: path.join(pdfjsRoot, 'wasm') + path.sep,
  enableXfa: false,
  verbosity: 0,
};

const openTasks: Array<{ destroy: () => Promise<void> }> = [];

function load(name: string, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({ ...commonOptions, data: new Uint8Array(readFileSync(fixture(name))), password });
  openTasks.push(task);
  return task.promise;
}

afterEach(async () => {
  await Promise.all(openTasks.splice(0).map((task) => task.destroy()));
});

async function pageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

describe('text.pdf', () => {
  it('hat Seiten, Metadaten und durchsuchbaren Text mit Umlauten', async () => {
    const pdf = await load(TEXT_PDF.file);
    expect(pdf.numPages).toBe(TEXT_PDF.pages);
    const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> };
    expect(info.Title).toBe(TEXT_PDF.title);
    expect(info.Author).toBe(TEXT_PDF.author);
    let hits = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const text = await pageText(pdf, p);
      hits += text.split(TEXT_PDF.searchTerm).length - 1;
    }
    expect(hits).toBe(TEXT_PDF.searchHits);
    expect(await pageText(pdf, 1)).toContain('ä, ö und ü sowie das ß');
  });

  it('hat Lesezeichen und klickbare Links', async () => {
    const pdf = await load(TEXT_PDF.file);
    const outline = (await pdf.getOutline()) ?? [];
    expect(outline.map((item) => item.title)).toEqual(TEXT_PDF.outlineTop);
    expect(outline[1]?.items.map((item) => item.title)).toEqual(TEXT_PDF.outlineChildren);
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    const links = annotations.filter((a) => a.subtype === 'Link');
    expect(links.filter((a) => a.url === TEXT_PDF.externalUrl)).toHaveLength(1);
    const targets = await Promise.all(
      links
        .filter((a) => Array.isArray(a.dest))
        .map(async (a) => (await pdf.getPageIndex(a.dest[0])) + 1),
    );
    expect(targets).toEqual(TEXT_PDF.tocLinks);
  });
});

describe('verschluesselt.pdf', () => {
  it('verlangt ein Kennwort, lehnt falsche ab und öffnet mit dem richtigen', async () => {
    await expect(load('verschluesselt.pdf')).rejects.toMatchObject({ name: 'PasswordException', code: pdfjs.PasswordResponses.NEED_PASSWORD });
    await expect(load('verschluesselt.pdf', 'falsch')).rejects.toMatchObject({ code: pdfjs.PasswordResponses.INCORRECT_PASSWORD });
    const pdf = await load('verschluesselt.pdf', PASSWORDS.user);
    expect(pdf.numPages).toBe(TEXT_PDF.pages);
    const permissions = await pdf.getPermissions();
    expect(permissions?.has(pdfjs.PermissionFlag.PRINT)).toBe(true);
    expect(permissions?.has(pdfjs.PermissionFlag.COPY)).toBe(false);
    const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> };
    expect(info.EncryptFilterName).toBe('Standard');
  });
});

describe('eingeschraenkt.pdf', () => {
  it('öffnet ohne Kennwort, verbietet aber das Drucken', async () => {
    const pdf = await load('eingeschraenkt.pdf');
    const permissions = await pdf.getPermissions();
    expect(permissions?.has(pdfjs.PermissionFlag.PRINT)).toBe(false);
  });
});

describe('beschädigte Dateien', () => {
  it('kaputte-xref.pdf wird repariert und vollständig gelesen', async () => {
    const pdf = await load('kaputte-xref.pdf');
    expect(pdf.numPages).toBe(TEXT_PDF.pages);
    expect(await pageText(pdf, 9)).toContain(TEXT_PDF.searchTerm);
  });

  it('abgeschnitten.pdf wird geöffnet oder mit verständlichem Fehler abgelehnt', async () => {
    try {
      const pdf = await load('abgeschnitten.pdf');
      expect(pdf.numPages).toBeGreaterThan(0);
      } catch (error) {
      expect((error as Error).name).toBe('InvalidPDFException');
    }
  });
});

describe('scan.pdf und formular.pdf', () => {
  it('scan.pdf enthält ein Bild, aber keinen Text', async () => {
    const pdf = await load('scan.pdf');
    expect(pdf.numPages).toBe(1);
    expect((await pageText(pdf, 1)).trim()).toBe('');
    const ops = await (await pdf.getPage(1)).getOperatorList();
    expect(ops.fnArray).toContain(pdfjs.OPS.paintImageXObject);
  });

  it('formular.pdf enthält alle Feldtypen', async () => {
    const pdf = await load('formular.pdf');
    // pdf.js 6 liefert eine Map, ältere Versionen ein Objekt
    const fields = (await pdf.getFieldObjects()) as Map<string, unknown> | Record<string, unknown> | null;
    const names = fields instanceof Map ? [...fields.keys()] : Object.keys(fields ?? {});
    expect(names.sort()).toEqual(['einverstanden', 'farbe', 'land', 'name']);
    const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> };
    expect(info.IsAcroFormPresent).toBe(true);
  });
});

describe.skipIf(!existsSync(LARGE_PDF))('große Datei über Range-Transport', () => {
  it('öffnet 600 Seiten schnell und liest nur angeforderte Bereiche', async () => {
    const data = readFileSync(LARGE_PDF);
    let bytesRead = 0;
    const requested: Array<[number, number]> = [];
    const read = async (begin: number, end: number) => {
      bytesRead += end - begin;
      requested.push([begin, end]);
      return new Uint8Array(data.subarray(begin, end));
    };
    const initial = await read(0, RANGE_CHUNK_SIZE);
    const range = createRangeTransport(pdfjs.PDFDataRangeTransport, data.length, initial, read, (error) => {
      throw error;
    });
    const started = performance.now();
    const task = pdfjs.getDocument({ ...commonOptions, range, rangeChunkSize: RANGE_CHUNK_SIZE, disableAutoFetch: true, disableStream: true });
    openTasks.push(task);
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(600);
    expect(await pageText(pdf, 1)).toContain('Seite 1 von 600');
    expect(await pageText(pdf, 600)).toContain('Suchprobe');
    const elapsed = performance.now() - started;
    // Jede Anfrage bleibt innerhalb der Datei und kein Block wird doppelt gelesen.
    expect(requested.every(([b, e]) => b >= 0 && e <= data.length && e > b)).toBe(true);
    expect(bytesRead).toBeLessThanOrEqual(data.length);
    // Hinweis: pdf.js lädt beim Öffnen die Beschreibungen aller Seiten vor. Liegen diese über die Datei verteilt
    // (wie hier), wird dabei fast die ganze Datei gelesen. Das passiert parallel und muss trotzdem zügig gehen.
    expect(elapsed).toBeLessThan(10_000);
  });
});
