// Textdokumente → Dokumentmodell → HTML (ADR 0019). Das Setzen als PDF prüft der Oberflächentest.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConvertError, detectAndConvert } from '../../src/main/convert';
import type { Block, DocumentModel, Paragraph } from '../../src/main/convert/model';
import { parseXml, textContent } from '../../src/main/convert/xml';
import { readZip } from '../../src/main/convert/zip';
import { wordDocument, zipStored } from '../fixtures/docx';

const documents = path.join(import.meta.dirname, '..', 'fixtures', 'documents');
const convert = (bytes: Uint8Array, name: string) => {
  const result = detectAndConvert(bytes, name);
  if (result.kind !== 'html') throw new Error('kein HTML');
  return result;
};
const paragraphs = (blocks: Block[]): Paragraph[] => blocks.filter((block): block is Paragraph => block.kind === 'paragraph');
const plain = (p: Paragraph) => p.inlines.map((inline) => (inline.kind === 'text' ? inline.text : '')).join('');
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(documents, name)));

function expectSample(model: DocumentModel): void {
  const texts = paragraphs(model.blocks).map(plain).join('\n');
  expect(texts).toContain('Quartalsbericht Größenordnung');
  expect(texts).toContain('äöüß ÄÖÜ und dem Euro €');
  expect(texts).toContain('Erster Punkt');
  const bold = paragraphs(model.blocks).flatMap((p) => p.inlines).find((inline) => inline.kind === 'text' && inline.text === 'fetter');
  expect(bold?.kind === 'text' && bold.style.bold).toBe(true);
  const centered = paragraphs(model.blocks).find((p) => plain(p) === 'Zentrierter Schluss');
  expect(centered?.style.align).toBe('center');
}

describe('Textdokumente umwandeln', () => {
  it('liest XML mit Entitäten, CDATA und ohne DTD-Auswertung', () => {
    const root = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "boom">]><r a="1 &amp; 2"><b>&lt;Text&gt; &#228;&#x20AC;&a;</b><![CDATA[<roh>]]></r>');
    const r = root.children[0] as { attrs: Record<string, string> };
    expect(r.attrs.a).toBe('1 & 2');
    expect(textContent(root)).toBe('<Text> ä€&a;<roh>');
  });

  it('liest ZIP-Archive', () => {
    const zip = readZip(zipStored({ 'a.txt': 'hallo', 'b/c.xml': '<x/>' }));
    expect(zip.names).toEqual(['a.txt', 'b/c.xml']);
    expect(zip.text('a.txt')).toBe('hallo');
    expect(zip.read('fehlt')).toBeNull();
  });

  it('wandelt Word (.docx) mit Vorlagen, Listen, Tabelle, Bild, Link und Fußnote um', () => {
    const { model, html } = convert(wordDocument(), 'bericht.docx');
    expect(model.title).toBe('Jahresbericht');
    expect(model.lang).toBe('de-DE');
    expect(model.font).toBe('Calibri');
    expect(model.size).toBe(11);
    expect(model.page.width).toBe(612);
    expect(model.page.margins.left).toBe(72);
    const list = paragraphs(model.blocks);
    const heading = list.find((p) => plain(p) === 'Jahresbericht 2026');
    expect(heading?.heading).toBe(1);
    expect(heading?.inlines[0]?.kind === 'text' && heading.inlines[0].style).toMatchObject({ font: 'Calibri Light', color: '#2f5496', size: 16 });
    expect(list.find((p) => plain(p) === 'Ziele')?.heading).toBe(2);
    expect(list.filter((p) => p.marker).map((p) => p.marker)).toEqual(['•', '•', '1.', '1.a)', '1.b)', '2.']);
    const link = list.flatMap((p) => p.inlines).find((inline) => inline.kind === 'text' && inline.text === 'einem Link');
    expect(link).toMatchObject({ link: 'https://example.org/bericht', style: { color: '#0563c1', underline: true } });
    const table = model.blocks.find((block) => block.kind === 'table');
    expect(table?.kind === 'table' && table.borders).toBe(true);
    if (table?.kind !== 'table') throw new Error('keine Tabelle');
    expect(table.rows.map((row) => row.length)).toEqual([2, 3, 2]);
    expect(table.rows[0]?.[1]?.colSpan).toBe(2);
    expect(table.rows[1]?.[0]?.rowSpan).toBe(2);
    expect(table.rows[0]?.[0]).toMatchObject({ background: '#d9e2f3', header: true });
    const image = list.flatMap((p) => p.inlines).find((inline) => inline.kind === 'image');
    expect(image).toMatchObject({ kind: 'image', width: 100, height: 50, alt: 'Firmenlogo' });
    expect(model.blocks.some((block) => block.kind === 'pageBreak')).toBe(true);
    expect(model.notes).toHaveLength(1);
    expect(html).toContain('<h1');
    expect(html).toContain('href="https://example.org/bericht"');
    expect(html).toContain('size: 612pt 792pt');
    expect(html).toContain('Quelle: eigene Erhebung.');
    expect(html).toContain('data:image/png;base64,');
  });

  it('wandelt die Beispiele aus TextEdit um (DOCX, ODT, RTF)', () => {
    for (const name of ['beispiel.docx', 'beispiel.odt', 'beispiel.rtf']) expectSample(convert(fixture(name), name).model);
    const odt = convert(fixture('beispiel.odt'), 'beispiel.odt').model;
    expect(paragraphs(odt.blocks).filter((p) => p.marker).map((p) => p.marker)).toEqual(['•', '•', '1', '2', '3']);
    expect(odt.blocks.some((block) => block.kind === 'table')).toBe(true);
    expect(convert(fixture('beispiel.rtf'), 'beispiel.rtf').model.blocks.some((block) => block.kind === 'table')).toBe(true);
  });

  it('wandelt Text und Markdown um', () => {
    const text = convert(new TextEncoder().encode('Zeile 1\n\nZeile 3 mit   Leerzeichen'), 'notiz.txt').model;
    expect(paragraphs(text.blocks).map(plain)).toEqual(['Zeile 1', '', 'Zeile 3 mit   Leerzeichen']);
    const latin1 = convert(new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0x80]), 'alt.txt').model;
    expect(plain(paragraphs(latin1.blocks)[0] as Paragraph)).toBe('Grüße €');
    const md = convert(new TextEncoder().encode('# Titel\n\nText mit **fett** und [Link](https://example.org).\n\n- a\n- b\n\n1. eins\n2. zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n'), 'readme.md').model;
    expect(md.title).toBe('Titel');
    expect(paragraphs(md.blocks)[0]?.heading).toBe(1);
    expect(paragraphs(md.blocks).filter((p) => p.marker).map((p) => p.marker)).toEqual(['•', '•', '1.', '2.']);
    expect(md.blocks.some((block) => block.kind === 'table')).toBe(true);
  });

  it('maskiert Inhalte im HTML und lässt nur sichere Links zu', () => {
    const { html } = convert(new TextEncoder().encode('[x](javascript:alert(1)) <script>alert(1)</script>'), 'boese.md');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain("default-src 'none'");
  });

  it('erkennt nicht unterstützte Formate', () => {
    expect(() => detectAndConvert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), 'alt.doc')).toThrow(ConvertError);
    expect(() => detectAndConvert(new Uint8Array([1, 2, 0, 4]), 'bild.bin')).toThrow(ConvertError);
    expect(() => detectAndConvert(zipStored({ 'Index/Document.iwa': 'x' }), 'brief.pages')).toThrow(ConvertError);
    const pdf = new TextEncoder().encode('%PDF-1.4 vorschau');
    const pages = detectAndConvert(zipStored({ 'Index/Document.iwa': 'x', 'QuickLook/Preview.pdf': pdf }), 'brief.pages');
    expect(pages.kind).toBe('pdf');
  });
});
