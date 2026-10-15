// Komprimieren (Phase 6, ADR 0013): Stufen und ihre Einstellungen. Gemeinsam für Oberfläche und Worker.

export type CompressionLevel = 'light' | 'medium' | 'strong';

export interface CompressionSettings {
  // Höchste Bildauflösung, bezogen auf die größte Seite des Dokuments
  dpi: number;
  // JPEG-Qualität 0 bis 1
  quality: number;
}

export const COMPRESSION_LEVELS: Record<CompressionLevel, CompressionSettings> = {
  light: { dpi: 300, quality: 0.85 },
  medium: { dpi: 150, quality: 0.75 },
  strong: { dpi: 100, quality: 0.6 },
};

// Bilder unter dieser Größe (Bildpunkte) lohnen das Neukodieren nicht
export const MIN_IMAGE_PIXELS = 40_000;
// Ein neu kodiertes Bild ersetzt das alte nur, wenn es deutlich kleiner ist
export const MIN_SAVING = 0.9;

// Verkleinert RGBA-Bildpunkte durch Mitteln (Flächenfilter); gut für starkes Verkleinern von Scans
export function downsample(rgba: Uint8Array, width: number, height: number, newWidth: number, newHeight: number): Uint8Array {
  const out = new Uint8Array(newWidth * newHeight * 4);
  const sx = width / newWidth;
  const sy = height / newHeight;
  for (let y = 0; y < newHeight; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < newWidth; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.floor((x + 1) * sx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += rgba[i] as number;
          g += rgba[i + 1] as number;
          b += rgba[i + 2] as number;
          a += rgba[i + 3] as number;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * newWidth + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// PNG-Prädiktoren (Predictor 10 bis 15) rückgängig machen: eine Filterangabe je Zeile, dann die Zeile
export function unpredictPng(data: Uint8Array, columns: number, bytesPerPixel: number): Uint8Array | null {
  const rowLength = columns * bytesPerPixel;
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  for (let y = 0; y < rows; y++) {
    const filter = data[y * (rowLength + 1)];
    const source = y * (rowLength + 1) + 1;
    const row = y * rowLength;
    for (let x = 0; x < rowLength; x++) {
      const raw = data[source + x] as number;
      const left = x >= bytesPerPixel ? (out[row + x - bytesPerPixel] as number) : 0;
      const up = y > 0 ? (out[row - rowLength + x] as number) : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? (out[row - rowLength + x - bytesPerPixel] as number) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          return null;
      }
      out[row + x] = value & 0xff;
    }
  }
  return out;
}
