// Getaggtes Test-PDF für die Prüfung der Barrierefreiheit, im Test erzeugt: Überschriften mit Sprung (H1 → H3),
// eine Abbildung ohne und eine mit Alternativtext, eine Tabelle ohne Kopfzellen, eine eigene Rolle über /RoleMap,
// ein Link ohne Strukturverweis. Keine Sprache, kein Titel.
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, type PDFRef } from '@cantoo/pdf-lib';

export async function taggedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Bericht', { x: 50, y: 780, size: 24, font });
  page.drawText('Einleitung', { x: 50, y: 740, size: 12, font });
  const context = doc.context;
  const link = context.register(context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 700, 150, 715], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.org') } }));
  page.node.set(PDFName.of('Annots'), context.obj([link]));
  const pg = page.ref;
  const element = (role: string, extra: Record<string, unknown> = {}, kids: unknown = 0): PDFRef =>
    context.register(context.obj({ Type: 'StructElem', S: role, Pg: pg, K: kids, ...extra } as never));
  const h1 = element('Ueberschrift', {}, 0);
  const p = element('P', {}, 1);
  const h3 = element('H3', {}, 2);
  const figureWithout = element('Figure', {}, 3);
  const figureWith = element('Figure', { Alt: PDFHexString.fromText('Diagramm der Umsätze') }, 4);
  const td = element('TD', {}, 5);
  const tr = element('TR', {}, [td]);
  const table = element('Table', {}, [tr]);
  const document = element('Document', {}, [h1, p, h3, figureWithout, figureWith, table]);
  doc.catalog.set(PDFName.of('StructTreeRoot'), context.register(context.obj({ Type: 'StructTreeRoot', K: [document], RoleMap: { Ueberschrift: 'H1' } } as never)));
  doc.catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }));
  return doc.save({ useObjectStreams: false });
}
