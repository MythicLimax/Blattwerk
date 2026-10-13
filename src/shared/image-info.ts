// Erkennt JPEG- und PNG-Dateien und liest Maße und EXIF-Ausrichtung, ohne das Bild zu dekodieren.
import type { ImageSource } from './pages';
import { A4 } from './pages';

export interface ImageInfo {
  kind: 'jpeg' | 'png';
  width: number;
  height: number;
  rotation: ImageSource['rotation'];
}

export function isPdf(bytes: Uint8Array): boolean {
  // Die Signatur darf laut Norm innerhalb der ersten 1024 Byte stehen.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

function readPng(bytes: Uint8Array): ImageInfo | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Erster Abschnitt muss IHDR sein: Breite und Höhe ab Byte 16
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { kind: 'png', width, height, rotation: 0 } : null;
}

// EXIF-Ausrichtung (Tag 0x0112) aus einem APP1-Abschnitt
function exifRotation(view: DataView, start: number, length: number): ImageInfo['rotation'] {
  // "Exif\0\0"
  if (length < 14 || view.getUint32(start) !== 0x45786966) return 0;
  const tiff = start + 6;
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > start + length) return 0;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > start + length) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      // 3 = 180°, 6 = 90° im Uhrzeigersinn, 8 = 270°; gespiegelte Varianten (2, 4, 5, 7) sind bei Fotos selten
      return value === 3 ? 180 : value === 6 ? 90 : value === 8 ? 270 : 0;
    }
  }
  return 0;
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rotation: ImageInfo['rotation'] = 0;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] as number;
    // Füllbytes
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) rotation = exifRotation(view, offset + 4, length - 2);
    // SOF0–SOF15 außer DHT (C4), JPG (C8) und DAC (CC) tragen die Bildmaße
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null;
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return width > 0 && height > 0 ? { kind: 'jpeg', width, height, rotation } : null;
    }
    offset += 2 + length;
  }
  return null;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

// Seitengröße für ein Bild: so groß wie das Bild (1 Pixel = 1 Punkt), aber höchstens A4 in passender Ausrichtung.
// Liefert auch die Matrix, die das Bild (Einheitsquadrat) auf die Seite legt, inklusive EXIF-Drehung.
export function imagePageLayout(info: Pick<ImageInfo, 'width' | 'height' | 'rotation'>): {
  width: number;
  height: number;
  matrix: [number, number, number, number, number, number];
} {
  const turned = info.rotation === 90 || info.rotation === 270;
  const shownWidth = turned ? info.height : info.width;
  const shownHeight = turned ? info.width : info.height;
  const landscape = shownWidth > shownHeight;
  const maxWidth = landscape ? A4.height : A4.width;
  const maxHeight = landscape ? A4.width : A4.height;
  const scale = Math.min(1, maxWidth / shownWidth, maxHeight / shownHeight);
  const width = Math.round(shownWidth * scale * 100) / 100;
  const height = Math.round(shownHeight * scale * 100) / 100;
  // Bild-Einheitsquadrat (0..1) → Seite; die Drehung erfolgt im Uhrzeigersinn um die Bildmitte
  switch (info.rotation) {
    case 90:
      return { width, height, matrix: [0, -height, width, 0, 0, height] };
    case 180:
      return { width, height, matrix: [-width, 0, 0, -height, width, height] };
    case 270:
      return { width, height, matrix: [0, height, -width, 0, width, 0] };
    default:
      return { width, height, matrix: [width, 0, 0, height, 0, 0] };
  }
}
