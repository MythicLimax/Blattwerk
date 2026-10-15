// Textdokumente in PDF umwandeln (ADR 0019): Format am Inhalt erkennen, in das Dokumentmodell übersetzen, als HTML
// von Chromium setzen lassen (pdf.ts).
import { convertDocx } from './docx';
import { documentHtml } from './html';
import type { DocumentModel } from './model';
import { convertOdt } from './odt';
import { convertRtf } from './rtf';
import { convertMarkdown, convertText } from './text';
import { readZip, type ZipArchive } from './zip';

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type DocumentFormat = 'docx' | 'odt' | 'rtf' | 'text' | 'markdown' | 'pages-pdf';

export class ConvertError extends Error {
  constructor(
    readonly code: 'unsupported' | 'legacy-doc' | 'pages' | 'invalid',
    detail: string,
  ) {
    super(detail);
    this.name = 'ConvertError';
  }
}

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, i) => bytes[i] === byte);

function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
}

export type Converted = { kind: 'html'; html: string; model: DocumentModel } | { kind: 'pdf'; bytes: Uint8Array };

export function detectAndConvert(bytes: Uint8Array, fileName: string): Converted {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) throw new ConvertError('legacy-doc', 'Word 97–2003');
  if (isZip(bytes)) {
    let zip: ZipArchive;
    try {
      zip = readZip(bytes);
    } catch (error) {
      throw new ConvertError('invalid', String(error));
    }
    const mimetype = zip.text('mimetype')?.trim();
    if (mimetype?.startsWith('application/vnd.oasis.opendocument.text')) return html(convertOdt(zip));
    if (zip.has('word/document.xml') || zip.has('_rels/.rels')) {
      try {
        return html(convertDocx(zip));
      } catch (error) {
        throw new ConvertError('invalid', String(error));
      }
    }
    // Pages legt eine fertige PDF-Vorschau bei (nicht in allen Versionen)
    if (zip.has('Index/Document.iwa') || extension === 'pages') {
      const preview = zip.read('QuickLook/Preview.pdf');
      if (preview && startsWith(preview, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', bytes: preview };
      throw new ConvertError('pages', 'Pages ohne PDF-Vorschau');
    }
    throw new ConvertError('unsupported', 'unbekanntes ZIP-Format');
  }
  if (startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return html(convertRtf(bytes));
  // Textdateien: keine Nullbytes (außer UTF-16 mit BOM)
  const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!utf16 && bytes.subarray(0, 8192).includes(0)) throw new ConvertError('unsupported', 'Binärdatei');
  return html(extension === 'md' || extension === 'markdown' ? convertMarkdown(bytes) : convertText(bytes));
}

function html(model: DocumentModel): Converted {
  return { kind: 'html', html: documentHtml(model), model };
}
