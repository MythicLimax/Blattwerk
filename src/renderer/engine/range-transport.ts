import type { PDFDataRangeTransport } from 'pdfjs-dist';
import { readChunked, type ReadRangeFn } from './file-reader';

// Bis zu dieser Größe wird die Datei in einem Stück gelesen. Größere Dateien lädt pdf.js bei Bedarf in Bereichen.
export const WHOLE_FILE_LIMIT = 8 * 1024 * 1024;
// pdf.js fordert Daten in Blöcken dieser Größe an. Für lokale Dateien sind größere Blöcke schneller als viele kleine.
export const RANGE_CHUNK_SIZE = 1024 * 1024;
// Höchstzahl gleichzeitiger Lesezugriffe über IPC.
const MAX_PARALLEL_READS = 6;

type RangeTransportClass = new (length: number, initialData: Uint8Array | null) => PDFDataRangeTransport;

// Liefert pdf.js Bytebereiche aus der Datei im Hauptprozess, statt die ganze Datei zu laden.
// So öffnen auch sehr große PDFs sofort, und nur benötigte Teile landen im Speicher.
// Die Basisklasse wird übergeben, damit Tests die Node-Variante von pdf.js nutzen können.
export function createRangeTransport(
  Base: RangeTransportClass,
  length: number,
  initialData: Uint8Array,
  read: ReadRangeFn,
  onError: (error: unknown) => void,
): PDFDataRangeTransport {
  class IpcRangeTransport extends Base {
    #queue: Array<{ begin: number; end: number }> = [];
    #active = 0;

    override requestDataRange(begin: number, end: number): void {
      this.#queue.push({ begin, end: Math.min(end, length) });
      this.#pump();
    }

    // Begrenzte Parallelität, damit hunderte Anfragen den Hauptprozess nicht auf einmal fluten.
    #pump(): void {
      while (this.#active < MAX_PARALLEL_READS && this.#queue.length > 0) {
        const request = this.#queue.shift() as { begin: number; end: number };
        this.#active++;
        readChunked(read, request.begin, request.end)
          .then(
            (chunk) => this.onDataRange(request.begin, chunk),
            (error: unknown) => onError(error),
          )
          .finally(() => {
            this.#active--;
            this.#pump();
          });
      }
    }
  }
  return new IpcRangeTransport(length, initialData);
}
