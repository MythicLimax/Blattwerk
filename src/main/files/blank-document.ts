// Neues leeres Dokument („Unbenannt“): eine leere A4-Seite in einem temporären Ordner der App. Der Tab gilt als
// unbenannt; „Sichern“ fragt nach Ort und Namen (wie in Pages oder Word). Der Ordner wird beim Beenden gelöscht.
import { app } from 'electron';
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_NAME } from '../../shared/product';

// A4 hoch in Punkt
const A4 = [595.28, 841.89] as const;

// Kleinstes gültiges PDF mit einer leeren Seite; Querverweistabelle mit genauen Positionen
export function blankPdf(now = new Date()): Uint8Array {
  const two = (n: number) => String(n).padStart(2, '0');
  const date = `D:${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}Z`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Resources << >> /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream',
    `<< /Producer (${PRODUCT_NAME}) /Creator (${PRODUCT_NAME}) /CreationDate (${date}) /ModDate (${date}) >>`,
  ];
  let body = '%PDF-1.7\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, 'latin1'));
}

let folder: string | null = null;
let counter = 0;

function blankFolder(): string {
  folder ??= path.join(app.getPath('temp'), `${PRODUCT_NAME.toLowerCase()}-neu-${process.pid}`);
  mkdirSync(folder, { recursive: true });
  return folder;
}

// Legt „Unbenannt.pdf“ (bzw. „Unbenannt 2.pdf“ …) an und liefert den Pfad
export async function createBlankDocument(baseName: string): Promise<string> {
  counter++;
  const file = path.join(blankFolder(), `${baseName}${counter > 1 ? ` ${counter}` : ''}.pdf`);
  await writeFile(file, blankPdf());
  return file;
}

export const isBlankDocumentPath = (filePath: string): boolean => folder !== null && path.dirname(filePath) === folder;

export function removeBlankDocuments(): void {
  if (folder) rmSync(folder, { recursive: true, force: true });
}
