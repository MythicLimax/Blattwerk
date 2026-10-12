// Hilfsfunktionen für den Speicher des PDFium-WASM-Moduls. Jede Reservierung wird wieder freigegeben.
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

export type Pdfium = WrappedPdfiumModule;

export function withBuffer<T>(m: Pdfium, size: number, fn: (ptr: number) => T): T {
  const ptr = m.pdfium.wasmExports.malloc(size);
  if (!ptr) throw new Error('PDFium: kein Speicher');
  try {
    return fn(ptr);
  } finally {
    m.pdfium.wasmExports.free(ptr);
  }
}

// Zeichenkette als UTF-16LE mit Nullterminator (FPDF_WIDESTRING).
export function withWString<T>(m: Pdfium, value: string, fn: (ptr: number) => T): T {
  const size = (value.length + 1) * 2;
  return withBuffer(m, size, (ptr) => {
    m.pdfium.stringToUTF16(value, ptr, size);
    return fn(ptr);
  });
}

export function withFloats<T>(m: Pdfium, values: number[], fn: (ptr: number) => T): T {
  return withBuffer(m, Math.max(4, values.length * 4), (ptr) => {
    values.forEach((value, i) => m.pdfium.setValue(ptr + i * 4, value, 'float'));
    return fn(ptr);
  });
}

// Liest einen UTF-16-Wert über das übliche PDFium-Muster (erst Länge erfragen, dann füllen).
export function readWString(m: Pdfium, read: (buffer: number, length: number) => number): string {
  const length = read(0, 0);
  if (length <= 2) return '';
  return withBuffer(m, length, (ptr) => {
    read(ptr, length);
    return m.pdfium.UTF16ToString(ptr);
  });
}

export function copyOut(m: Pdfium, ptr: number, size: number): Uint8Array {
  return m.pdfium.HEAPU8.slice(ptr, ptr + size);
}
