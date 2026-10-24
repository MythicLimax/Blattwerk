import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { cleanDocument, findCleanable } from '../../src/workers/pdfium/clean';

// Dokument mit allem, was Bereinigen entfernen kann; dazu ein Link auf eine Webseite, der bleiben muss
async function loadedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Geheimer Titel');
  doc.setAuthor('Max Mustermann');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.drawText('Inhalt bleibt', { x: 20, y: 250, size: 12, font });
  await doc.attach(new TextEncoder().encode('geheimer Anhang'), 'anhang.txt', { mimeType: 'text/plain' });
  doc.addJavaScript('start', 'app.alert("Hallo")');
  const outline = doc.context.obj({ Type: 'Outlines', Count: 0 });
  doc.catalog.set(PDFName.of('Outlines'), doc.context.register(outline));
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript', JS: 'app.alert(1)' } }));
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 10, 100, 30], A: { S: 'URI', URI: PDFString.of('https://example.org') } });
  const script = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [10, 40, 100, 60], A: { S: 'GoTo', D: [page.ref, 'Fit'], Next: { S: 'JavaScript', JS: 'app.alert(2)' } } });
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link), doc.context.register(script)]));
  return doc.save({ useObjectStreams: false });
}

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

describe('Dokument bereinigen', () => {
  it('findet und entfernt Metadaten, Anhänge, Skripte und Lesezeichen; Inhalt und Weblinks bleiben', async () => {
    const before = await loadedPdf();
    expect(await findCleanable(before)).toEqual({ metadata: true, attachments: true, scripts: true, bookmarks: true });
    const after = await cleanDocument(before, { metadata: true, attachments: true, scripts: true, bookmarks: true });
    expect(await findCleanable(after)).toEqual({ metadata: false, attachments: false, scripts: false, bookmarks: false });
    const raw = text(after);
    for (const secret of ['Geheimer Titel', 'Mustermann', 'geheimer Anhang', 'app.alert', '/Outlines']) expect(raw).not.toContain(secret);
    expect(raw).toContain('https://example.org');
    const doc = await PDFDocument.load(after);
    expect(doc.getPageCount()).toBe(1);
  });

  it('entfernt nur, was gewählt ist', async () => {
    const after = await cleanDocument(await loadedPdf(), { metadata: false, attachments: false, scripts: true, bookmarks: false });
    expect(await findCleanable(after)).toEqual({ metadata: true, attachments: true, scripts: false, bookmarks: true });
  });
});
