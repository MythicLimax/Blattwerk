// Prüft gespeicherte Dateien mit Apples PDFKit (der Engine von „Vorschau“). Nur unter macOS.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SCRIPT = `
ObjC.import('PDFKit');
ObjC.import('AppKit');
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (!doc || doc.isNil()) return JSON.stringify({ ok: false, pages: [] });
  const pages = [];
  for (let i = 0; i < doc.pageCount; i++) {
    const annotations = doc.pageAtIndex(i).annotations;
    const types = [];
    for (let j = 0; j < annotations.count; j++) types.push(ObjC.unwrap(annotations.objectAtIndex(j).type));
    pages.push(types);
  }
  if (argv[1]) {
    const image = doc.pageAtIndex(0).thumbnailOfSizeForBox($.NSMakeSize(1190, 1684), 0);
    const bitmap = $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
    bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(argv[1], true);
  }
  return JSON.stringify({ ok: true, pages });
}
`;

export interface PdfKitResult {
  ok: boolean;
  // Anmerkungsarten je Seite, wie PDFKit sie erkennt (z. B. "Highlight", "Text", "Ink")
  pages: string[][];
}

export function inspectWithPdfKit(file: string, renderTo?: string): PdfKitResult {
  const script = path.join(tmpdir(), 'blattwerk-pdfkit.js');
  writeFileSync(script, SCRIPT);
  const output = execFileSync('osascript', ['-l', 'JavaScript', script, file, ...(renderTo ? [renderTo] : [])], {
    encoding: 'utf8',
  });
  return JSON.parse(output.trim()) as PdfKitResult;
}
