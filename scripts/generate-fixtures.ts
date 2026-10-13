// Erzeugt die Test-PDFs in test/fixtures/pdfs/ (klein, eingecheckt) und test/fixtures/generated/ (groß, nicht eingecheckt).
// Aufruf: npm run fixtures            (alle kleinen Dateien)
//         npm run fixtures -- --large (zusätzlich die große Datei mit 600 Seiten)
import {
  PDFArray,
  type PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFRef,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from '@cantoo/pdf-lib';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'test', 'fixtures', 'pdfs');
const generatedDir = path.join(root, 'test', 'fixtures', 'generated');
const imagesDir = path.join(root, 'test', 'fixtures', 'images');
const FIXED_DATE = new Date(Date.UTC(2026, 0, 15, 9, 30, 0));

// Diese Werte prüfen die Tests. Bei Änderungen auch test/fixtures/expectations.ts anpassen.
export const SEARCH_TERM = 'Suchprobe';

const LOREM = [
  'Dies ist ein Testdokument für Blattwerk. Es enthält mehrere Seiten mit Fließtext, Überschriften und Verweisen.',
  'Die Umlaute ä, ö und ü sowie das ß müssen beim Kopieren und Suchen korrekt erscheinen.',
  'Ein PDF besteht aus Objekten, die über eine Querverweistabelle gefunden werden.',
  'Große Dokumente sollen flüssig scrollen, auch wenn sie viele hundert Seiten haben.',
];

function drawParagraphs(page: PDFPage, font: PDFFont, lines: string[], startY: number): void {
  let y = startY;
  for (const line of lines) {
    page.drawText(line, { x: 56, y, size: 11, font, color: rgb(0.1, 0.1, 0.1), maxWidth: 480, lineHeight: 15 });
    y -= 34;
  }
}

function addLink(doc: PDFDocument, page: PDFPage, rect: [number, number, number, number], action: PDFDict): void {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rect,
    Border: [0, 0, 0],
    A: action,
  });
  const ref = doc.context.register(annot);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
}

function goToAction(doc: PDFDocument, target: PDFPage): PDFDict {
  return doc.context.obj({ S: 'GoTo', D: [target.ref, PDFName.of('Fit')] });
}

function uriAction(doc: PDFDocument, uri: string): PDFDict {
  return doc.context.obj({ S: 'URI', URI: PDFString.of(uri) });
}

interface OutlineSpec {
  title: string;
  page: number;
  children?: OutlineSpec[];
}

// Lesezeichenbaum von Hand bauen (pdf-lib hat dafür keine fertige Funktion).
function addOutline(doc: PDFDocument, specs: OutlineSpec[]): void {
  const ctx = doc.context;
  const pages = doc.getPages();
  const rootRef = ctx.nextRef();

  const build = (items: OutlineSpec[], parentRef: PDFRef): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = items.map(() => ctx.nextRef());
    let total = 0;
    items.forEach((item, i) => {
      const page = pages[item.page - 1];
      if (!page) throw new Error(`Seite ${item.page} fehlt`);
      const dict = ctx.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: parentRef,
        Dest: [page.ref, PDFName.of('XYZ'), null, null, null],
      }) as PDFDict;
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1] as PDFRef);
      if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1] as PDFRef);
      total++;
      if (item.children?.length) {
        const child = build(item.children, refs[i] as PDFRef);
        dict.set(PDFName.of('First'), child.first);
        dict.set(PDFName.of('Last'), child.last);
        dict.set(PDFName.of('Count'), PDFNumber.of(child.count));
        total += child.count;
      }
      ctx.assign(refs[i] as PDFRef, dict);
    });
    return { first: refs[0] as PDFRef, last: refs[refs.length - 1] as PDFRef, count: total };
  };

  const top = build(specs, rootRef);
  ctx.assign(
    rootRef,
    ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: PDFNumber.of(top.count) }),
  );
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

function setMetadata(doc: PDFDocument, title: string): void {
  doc.setTitle(title);
  doc.setAuthor('Blattwerk-Testsuite');
  doc.setSubject('Automatisch erzeugtes Test-PDF');
  doc.setKeywords(['Test', 'Blattwerk', 'PDF']);
  doc.setCreator('scripts/generate-fixtures.ts');
  doc.setProducer('@cantoo/pdf-lib');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
}

// Text-PDF: 12 Seiten, Lesezeichen, interne und externe Links, Suchbegriff genau 6-mal.
async function buildTextPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMetadata(doc, 'Testdokument mit Text');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = Array.from({ length: 12 }, () => doc.addPage([595.28, 841.89]));

  const searchHits: Record<number, number> = { 2: 2, 5: 1, 9: 3 };
  pages.forEach((page, index) => {
    const number = index + 1;
    page.drawText(`Seite ${number}`, { x: 500, y: 40, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    const heading =
      number === 1 ? 'Testdokument mit Text' : number === 3 ? 'Kapitel 1' : number === 6 ? 'Kapitel 2' : number === 10 ? 'Kapitel 3' : `Inhalt ${number}`;
    page.drawText(heading, { x: 56, y: 770, size: 20, font: bold });
    const lines = [...LOREM];
    const hits = searchHits[number] ?? 0;
    for (let i = 0; i < hits; i++) lines.push(`Hier steht die ${SEARCH_TERM} Nummer ${i + 1} auf dieser Seite.`);
    drawParagraphs(page, font, lines, 720);
  });

  // Inhaltsverzeichnis auf Seite 1 mit klickbaren Einträgen
  const first = pages[0] as PDFPage;
  const toc: Array<[string, number]> = [
    ['Kapitel 1 ........ Seite 3', 3],
    ['Kapitel 2 ........ Seite 6', 6],
    ['Kapitel 3 ........ Seite 10', 10],
  ];
  first.drawText('Inhaltsverzeichnis', { x: 56, y: 520, size: 14, font: bold });
  toc.forEach(([label, target], i) => {
    const y = 490 - i * 22;
    first.drawText(label, { x: 56, y, size: 12, font, color: rgb(0.1, 0.3, 0.8) });
    addLink(doc, first, [52, y - 4, 320, y + 14], goToAction(doc, pages[target - 1] as PDFPage));
  });
  first.drawText('Externer Link: https://example.com', { x: 56, y: 400, size: 12, font, color: rgb(0.1, 0.3, 0.8) });
  addLink(doc, first, [52, 396, 300, 414], uriAction(doc, 'https://example.com/'));

  addOutline(doc, [
    { title: 'Testdokument mit Text', page: 1 },
    {
      title: 'Kapitel 1',
      page: 3,
      children: [
        { title: 'Abschnitt 1.1', page: 4 },
        { title: 'Abschnitt 1.2', page: 5 },
      ],
    },
    { title: 'Kapitel 2', page: 6 },
    { title: 'Kapitel 3 – Übersicht', page: 10 },
  ]);

  return doc.save({ useObjectStreams: false });
}

async function buildFormPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMetadata(doc, 'Testformular');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  page.drawText('Anmeldeformular', { x: 56, y: 770, size: 20, font });

  page.drawText('Name:', { x: 56, y: 700, size: 12, font });
  const name = form.createTextField('name');
  name.addToPage(page, { x: 160, y: 692, width: 280, height: 22 });

  page.drawText('Einverstanden:', { x: 56, y: 650, size: 12, font });
  const consent = form.createCheckBox('einverstanden');
  consent.addToPage(page, { x: 160, y: 646, width: 18, height: 18 });

  page.drawText('Farbe:', { x: 56, y: 600, size: 12, font });
  const color = form.createRadioGroup('farbe');
  ['rot', 'gruen', 'blau'].forEach((option, i) => {
    color.addOptionToPage(option, page, { x: 160 + i * 60, y: 596, width: 16, height: 16 });
    page.drawText(option, { x: 180 + i * 60, y: 600, size: 10, font });
  });

  page.drawText('Land:', { x: 56, y: 550, size: 12, font });
  const country = form.createDropdown('land');
  country.setOptions(['Deutschland', 'Österreich', 'Schweiz']);
  country.select('Deutschland');
  country.addToPage(page, { x: 160, y: 542, width: 200, height: 22 });

  form.updateFieldAppearances(font);
  return doc.save({ useObjectStreams: false });
}

// Kommentare, wie sie ein anderes Programm anlegt: Hervorhebung, Notiz mit Antwort und Prüfstatus,
// Rechteck auf Seite 1, Freihandzeichnung auf Seite 2. Ohne Darstellungsströme, die erzeugen die Anzeigeprogramme selbst.
async function buildCommentsPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMetadata(doc, 'Testdokument mit Kommentaren');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [doc.addPage([595.28, 841.89]), doc.addPage([595.28, 841.89])];
  pages.forEach((page, index) => {
    page.drawText(index === 0 ? 'Dokument mit Kommentaren' : 'Zweite Seite', { x: 56, y: 770, size: 20, font: bold });
    drawParagraphs(page, font, LOREM, 720);
  });
  const date = PDFString.fromDate(FIXED_DATE);
  const text = (value: string) => PDFHexString.fromText(value);
  const add = (page: PDFPage, dict: Record<string, unknown>): PDFRef => {
    const ref = doc.context.register(doc.context.obj({ Type: 'Annot', M: date, CreationDate: date, ...dict } as never));
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
    return ref;
  };
  const [first, second] = pages as [PDFPage, PDFPage];
  add(first, {
    Subtype: 'Highlight',
    Rect: [54, 714, 420, 732],
    QuadPoints: [54, 732, 420, 732, 54, 714, 420, 714],
    C: [1, 0.9, 0.1],
    T: text('Erika Muster'),
    Contents: text('Bitte prüfen'),
    F: 4,
  });
  const note = add(first, {
    Subtype: 'Text',
    Rect: [520, 740, 540, 760],
    Name: 'Comment',
    C: [1, 0.8, 0.2],
    T: text('Erika Muster'),
    Contents: text('Vorhandene Notiz'),
    F: 28,
  });
  add(first, {
    Subtype: 'Text',
    Rect: [520, 740, 540, 760],
    IRT: note,
    RT: 'R',
    T: text('Max Beispiel'),
    Contents: text('Erledigt, danke'),
    F: 30,
  });
  add(first, {
    Subtype: 'Text',
    Rect: [520, 740, 540, 760],
    IRT: note,
    State: text('Accepted'),
    StateModel: text('Review'),
    T: text('Max Beispiel'),
    Contents: text('Accepted gesetzt von Max Beispiel'),
    F: 30,
  });
  add(first, {
    Subtype: 'Square',
    Rect: [300, 560, 420, 640],
    C: [0.85, 0.1, 0.1],
    BS: { W: 2, S: 'S' },
    T: text('Erika Muster'),
    Contents: text('Rahmen um den Absatz'),
    F: 4,
  });
  add(second, {
    Subtype: 'Ink',
    Rect: [100, 500, 260, 560],
    InkList: [[110, 510, 150, 550, 190, 510, 230, 550, 250, 520]],
    C: [0.1, 0.3, 0.9],
    BS: { W: 3, S: 'S' },
    T: text('Erika Muster'),
    F: 4,
  });
  return doc.save({ useObjectStreams: false });
}

async function encrypt(source: Uint8Array, options: Parameters<PDFDocument['encrypt']>[0]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source);
  doc.encrypt(options);
  return doc.save({ useObjectStreams: false });
}

// Querverweistabelle unbrauchbar machen: alle Offsets zeigen ins Leere.
function breakXref(source: Uint8Array): Uint8Array {
  const text = Buffer.from(source).toString('latin1');
  const xrefIndex = text.lastIndexOf('\nxref');
  if (xrefIndex < 0) throw new Error('Keine klassische xref-Tabelle gefunden');
  const head = text.slice(0, xrefIndex);
  const tail = text.slice(xrefIndex).replace(/\b\d{10} (\d{5}) n/g, '0000000013 $1 n');
  return Buffer.from(head + tail, 'latin1');
}

// Minimaler PNG-Encoder (RGB, 8 Bit), damit keine Bildbibliothek nötig ist.
function encodePng(width: number, height: number, rgbData: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgbData.subarray(y * width * 3, (y + 1) * width * 3)).copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', new Uint8Array()),
  ]);
}

// "Scan": Seite des Text-PDFs als Bild, ohne Textebene. Unter macOS rendert sips die Seite.
async function buildScanPdf(textPdf: Uint8Array): Promise<Uint8Array | null> {
  if (process.platform !== 'darwin') return null;
  const tmp = path.join(tmpdir(), `blattwerk-scan-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const onePage = await PDFDocument.create();
    const source = await PDFDocument.load(textPdf);
    const [copied] = await onePage.copyPages(source, [1]);
    if (copied) onePage.addPage(copied);
    const pdfPath = path.join(tmp, 'seite.pdf');
    const pngPath = path.join(tmp, 'seite.png');
    writeFileSync(pdfPath, await onePage.save());
    execFileSync('/usr/bin/sips', ['-s', 'format', 'png', '-s', 'dpiWidth', '200', '-s', 'dpiHeight', '200', pdfPath, '--out', pngPath], {
      stdio: 'ignore',
    });
    const doc = await PDFDocument.create();
    setMetadata(doc, 'Gescanntes Dokument');
    const image = await doc.embedPng(readFileSync(pngPath));
    const page = doc.addPage([595.28, 841.89]);
    page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
    return doc.save({ useObjectStreams: false });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Bild in vier farbigen Vierteln (oben links rot, oben rechts grün, unten links blau, unten rechts gelb),
// damit Tests die Ausrichtung nach dem Einbetten prüfen können.
function quadrantPixels(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  const colors = [
    [220, 30, 30],
    [30, 170, 60],
    [30, 60, 220],
    [240, 200, 20],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)] as number[];
      data.set(color, (y * width + x) * 3);
    }
  }
  return data;
}

// PNG mit Alphakanal (Farbtyp 6): linke Hälfte deckend rot, rechte Hälfte halb durchsichtig blau
function encodeRgbaPng(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)])) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw.set(x < width / 2 ? [220, 30, 30, 255] : [30, 60, 220, 128], o);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

// JPEG-Foto (Querformat 320 × 240) aus dem Viertelbild; unter macOS wandelt sips das PNG um.
function buildJpeg(): Uint8Array | null {
  if (process.platform !== 'darwin') return null;
  const tmp = path.join(tmpdir(), `blattwerk-jpeg-${randomBytes(4).toString('hex')}`);
  mkdirSync(tmp, { recursive: true });
  try {
    const pngPath = path.join(tmp, 'foto.png');
    const jpgPath = path.join(tmp, 'foto.jpg');
    writeFileSync(pngPath, encodePng(320, 240, quadrantPixels(320, 240)));
    execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', pngPath, '--out', jpgPath], { stdio: 'ignore' });
    return new Uint8Array(readFileSync(jpgPath));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Große Datei: 600 Seiten mit je einem Rauschbild (nicht komprimierbar), insgesamt über 100 MB.
async function buildLargePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMetadata(doc, 'Großes Testdokument');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const width = 300;
  const height = 220;
  for (let i = 1; i <= 600; i++) {
    const image = await doc.embedPng(encodePng(width, height, randomBytes(width * height * 3)));
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Seite ${i} von 600`, { x: 56, y: 780, size: 18, font });
    if (i === 600) page.drawText(`Letzte Seite mit der ${SEARCH_TERM}.`, { x: 56, y: 740, size: 12, font });
    page.drawImage(image, { x: 56, y: 300, width: 480, height: 352 });
  }
  return doc.save({ useObjectStreams: false });
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  // --only=name.pdf schreibt nur diese Datei (verschlüsselte Dateien ändern sich sonst bei jedem Lauf)
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
  const write = (name: string, data: Uint8Array) => {
    if (only && only !== name) return;
    writeFileSync(path.join(outDir, name), data);
    console.log(`${name}: ${(data.length / 1024).toFixed(1)} KB`);
  };

  const text = await buildTextPdf();
  write('text.pdf', text);
  write('formular.pdf', await buildFormPdf());
  write('kommentare.pdf', await buildCommentsPdf());
  write(
    'verschluesselt.pdf',
    await encrypt(text, {
      userPassword: 'geheim',
      ownerPassword: 'besitzer',
      permissions: { printing: 'highResolution', copying: false, modifying: false },
    }),
  );
  write(
    'eingeschraenkt.pdf',
    await encrypt(text, { ownerPassword: 'besitzer', permissions: { printing: false, copying: true } }),
  );
  write('kaputte-xref.pdf', breakXref(text));
  write('abgeschnitten.pdf', text.subarray(0, Math.floor(text.length * 0.7)));
  write('kein-pdf.pdf', Buffer.from('Das ist kein PDF, sondern einfacher Text.\n', 'utf8'));

  // Bilder für Phase 3 (Bilder in PDF umwandeln, Bilder als Seiten einfügen)
  mkdirSync(imagesDir, { recursive: true });
  const writeImage = (name: string, data: Uint8Array) => {
    if (only && only !== name) return;
    writeFileSync(path.join(imagesDir, name), data);
    console.log(`${name}: ${(data.length / 1024).toFixed(1)} KB`);
  };
  writeImage('viertel.png', encodePng(320, 240, quadrantPixels(320, 240)));
  writeImage('transparent.png', encodeRgbaPng(200, 100));
  const jpeg = only && only !== 'foto.jpg' ? null : buildJpeg();
  if (jpeg) writeImage('foto.jpg', jpeg);
  else if (!only && !existsSync(path.join(imagesDir, 'foto.jpg'))) console.warn('foto.jpg kann nur unter macOS erzeugt werden.');

  const scan = only && only !== 'scan.pdf' ? null : await buildScanPdf(text);
  if (scan) write('scan.pdf', scan);
  else if (!existsSync(path.join(outDir, 'scan.pdf'))) console.warn('scan.pdf kann nur unter macOS erzeugt werden.');

  if (process.argv.includes('--large')) {
    mkdirSync(generatedDir, { recursive: true });
    const large = await buildLargePdf();
    writeFileSync(path.join(generatedDir, 'gross-600-seiten.pdf'), large);
    console.log(`gross-600-seiten.pdf: ${(large.length / 1024 / 1024).toFixed(1)} MB`);
  }
}

await main();
