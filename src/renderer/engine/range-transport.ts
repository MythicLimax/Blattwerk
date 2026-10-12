import { pdfjs } from './pdfjs';
import { readChunked, type ReadRangeFn } from './file-reader';

// Liefert pdf.js Bytebereiche aus der Datei im Hauptprozess, statt die ganze Datei zu laden.
// So öffnen auch sehr große PDFs sofort, und nur benötigte Teile landen im Speicher.
export function createRangeTransport(
  length: number,
  initialData: Uint8Array,
  read: ReadRangeFn,
  onError: (error: unknown) => void,
): InstanceType<typeof pdfjs.PDFDataRangeTransport> {
  class IpcRangeTransport extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin: number, end: number): void {
      readChunked(read, begin, Math.min(end, length)).then(
        (chunk) => this.onDataRange(begin, chunk),
        (error: unknown) => onError(error),
      );
    }
  }
  return new IpcRangeTransport(length, initialData);
}
