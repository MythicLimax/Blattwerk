// Test-PDF zum Schwärzen (Phase 5): Geheimnisse an allen Stellen, an denen sie sich in einer PDF-Datei verstecken
// können. Wird in den Tests erzeugt (kein eingecheckter Binärstand), damit die Stellen genau bekannt sind.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { readFileSync } from 'node:fs';
import type { Rect } from '../../src/shared/annotations';
import { imageFixture } from './expectations';

export const SECRETS = {
  text: 'GEHEIM-TEXT-4711',
  stream: 'GEHEIM-STROM-0815',
  form: 'GEHEIM-FORM-1234',
  link: 'GEHEIM-LINK-9999',
  field: 'GEHEIM-FELD-2222',
  comment: 'GEHEIM-KOMMENTAR-7777',
  title: 'GEHEIM-TITEL-3333',
  xmp: 'GEHEIM-XMP-5555',
} as const;

export const PUBLIC = {
  heading: 'Vertraulicher Bericht',
  line: 'Dieser Satz bleibt lesbar.',
  page2: 'Seite zwei bleibt unverändert.',
  note: 'Öffentliche Notiz',
} as const;

// Bereiche auf Seite 1: Zeilen mit Geheimnissen (inkl. Link, Feld, Kommentar, kleiner Vektorform) und linke Bildhälfte
export const AREAS: Rect[] = [
  [40, 640, 560, 712],
  [40, 440, 156, 610],
];

// Kleine Vektorform (wie ein Buchstabe als Umriss) ganz im ersten Bereich
export const GLYPH_RECT: Rect = [520, 665, 540, 685];

// Bild (Viertel: rot, grün / blau, gelb) auf beiden Seiten an derselben Stelle
export const IMAGE_RECT: Rect = [56, 450, 256, 600];

export async function buildRedactionPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(`Bericht ${SECRETS.title}`);
  doc.setAuthor('Testautor');
  doc.setKeywords(['bericht']);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const image = await doc.embedPng(readFileSync(imageFixture('viertel.png')));
  const [x0, y0, x1, y1] = IMAGE_RECT;

  const page = doc.addPage([595.28, 841.89]);
  page.drawText(PUBLIC.heading, { x: 56, y: 780, size: 20, font });
  page.drawText(PUBLIC.line, { x: 56, y: 740, size: 12, font });
  page.drawText(`Kontonummer ${SECRETS.text}`, { x: 56, y: 690, size: 12, font });
  page.drawImage(image, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  page.drawRectangle({ x: 300, y: 450, width: 200, height: 150, color: rgb(0.2, 0.5, 0.2) });
  const [gl, gb, gr, gt] = GLYPH_RECT;
  page.drawSvgPath(`M ${gl} ${-gb} L ${gr} ${-gb} L ${(gl + gr) / 2} ${-gt} Z`, { x: 0, y: 0, color: rgb(0, 0, 0) });

  const context = doc.context;
  const fontName = 'FGeheim';
  // Zweiter Inhaltsstrom mit eigenem Text und ein Formular-XObject mit Text
  const resources = page.node.Resources() as PDFDict;
  (resources.lookup(PDFName.of('Font')) as PDFDict).set(PDFName.of(fontName), font.ref);
  const form = context.flateStream(`BT /${fontName} 12 Tf 0 0 Td (${SECRETS.form}) Tj ET`, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 200, 20],
    Resources: { Font: { [fontName]: font.ref } },
  });
  (resources.lookup(PDFName.of('XObject')) as PDFDict).set(PDFName.of('FxGeheim'), context.register(form));
  const extra = context.register(context.flateStream(`BT /${fontName} 12 Tf 56 670 Td (${SECRETS.stream}) Tj ET q 1 0 0 1 56 650 cm /FxGeheim Do Q`));
  const contents = page.node.get(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  page.node.set(PDFName.of('Contents'), context.obj([...streams, extra]));

  // Textfeld mit Wert im Bereich
  const field = doc.getForm().createTextField('notiz');
  field.setText(SECRETS.field);
  field.addToPage(page, { x: 300, y: 660, width: 200, height: 26, font });

  // Link mit geheimer Adresse, Kommentar im Bereich, öffentliche Notiz außerhalb
  const annot = (dict: Record<string, unknown>) => context.register(context.obj({ Type: 'Annot', ...dict } as never));
  const link = annot({ Subtype: 'Link', Rect: [56, 686, 250, 704], Border: [0, 0, 0], A: { S: 'URI', URI: PDFHexString.fromText(`https://example.com/${SECRETS.link}`) } });
  const comment = annot({ Subtype: 'Square', Rect: [450, 645, 470, 655], C: [1, 0, 0], Contents: PDFHexString.fromText(SECRETS.comment) });
  const note = annot({ Subtype: 'Text', Rect: [400, 300, 420, 320], C: [1, 1, 0], Contents: PDFHexString.fromText(PUBLIC.note) });
  const annots = page.node.Annots();
  for (const ref of [link, comment, note]) annots?.push(ref);
  if (!annots) page.node.set(PDFName.of('Annots'), context.obj([link, comment, note]));

  // XMP-Metadaten
  const xmp = context.stream(
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${SECRETS.xmp}</dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
    { Type: 'Metadata', Subtype: 'XML' },
  );
  doc.catalog.set(PDFName.of('Metadata'), context.register(xmp));

  const second = doc.addPage([595.28, 841.89]);
  second.drawText(PUBLIC.page2, { x: 56, y: 780, size: 12, font });
  second.drawImage(image, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });

  doc.getForm().updateFieldAppearances(font);
  return doc.save({ useObjectStreams: false });
}

// Sucht ein Geheimnis in allen üblichen Kodierungen: Klartext, Hex (ASCII) und UTF-16BE (Hex und Bytes).
export function containsSecret(haystack: Buffer | string, secret: string): boolean {
  const text = typeof haystack === 'string' ? haystack : haystack.toString('latin1');
  const upper = text.toUpperCase();
  const hexAscii = Buffer.from(secret, 'latin1').toString('hex').toUpperCase();
  const utf16 = Buffer.from(secret, 'utf16le').swap16();
  return text.includes(secret) || upper.includes(hexAscii) || upper.includes(utf16.toString('hex').toUpperCase()) || text.includes(utf16.toString('latin1'));
}
