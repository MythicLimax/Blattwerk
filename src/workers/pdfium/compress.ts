// PDF verkleinern mit @cantoo/pdf-lib (Phase 6, ADR 0013). Erwartet ein unverschlüsseltes, vollständig geschriebenes
// Dokument (PDFium übernimmt vorher Kommentare und Formularwerte).
// - Bilder: auf die Auflösung der Stufe verkleinern (bezogen auf die größte Seite) und als JPEG neu kodieren, wenn das
//   deutlich kleiner wird. Geteilte Bilder werden einmal behandelt, Transparenzmasken bleiben unverändert.
// - Ungepackte Datenströme packen (Flate), nicht mehr erreichbare Objekte verwerfen, Objektströme nutzen.
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFRef, type PDFObject } from '@cantoo/pdf-lib';
import { COMPRESSION_LEVELS, downsample, MIN_IMAGE_PIXELS, MIN_SAVING, unpredictPng, type CompressionLevel } from '../../shared/compress';
import { reachable, refKey } from './sanitize';

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

// JPEG lesen und schreiben: im Worker über die Bildkodierung des Browsers, in den Tests über jpeg-js
export interface ImageCodec {
  decodeJpeg(bytes: Uint8Array): Promise<DecodedImage>;
  encodeJpeg(image: DecodedImage, quality: number): Promise<Uint8Array>;
}

export class CompressError extends Error {
  readonly code = 'compress-encrypted';
  constructor(message: string) {
    super(message);
    this.name = 'CompressError';
  }
}

const NAME = {
  Subtype: PDFName.of('Subtype'),
  Image: PDFName.of('Image'),
  Filter: PDFName.of('Filter'),
  DecodeParms: PDFName.of('DecodeParms'),
  ColorSpace: PDFName.of('ColorSpace'),
  BitsPerComponent: PDFName.of('BitsPerComponent'),
  ImageMask: PDFName.of('ImageMask'),
  Decode: PDFName.of('Decode'),
  Mask: PDFName.of('Mask'),
  Width: PDFName.of('Width'),
  Height: PDFName.of('Height'),
  Length: PDFName.of('Length'),
  N: PDFName.of('N'),
  Predictor: PDFName.of('Predictor'),
  Colors: PDFName.of('Colors'),
  Columns: PDFName.of('Columns'),
  DCTDecode: PDFName.of('DCTDecode'),
  FlateDecode: PDFName.of('FlateDecode'),
  DeviceRGB: PDFName.of('DeviceRGB'),
  DeviceGray: PDFName.of('DeviceGray'),
  ICCBased: PDFName.of('ICCBased'),
} as const;

// Diese Einträge beschreibt das neue Bild selbst; alle übrigen (SMask, Intent, OC …) bleiben erhalten
const REPLACED = new Set(['Width', 'Height', 'Filter', 'DecodeParms', 'Length', 'ColorSpace', 'BitsPerComponent']);

const number = (value: PDFObject | undefined): number | null => (value instanceof PDFNumber ? value.asNumber() : null);

// Einziger Filter des Stroms (oder null bei keinem bzw. mehreren)
function singleFilter(doc: PDFDocument, dict: PDFDict): PDFName | null | 'none' {
  const filter = dict.lookup(NAME.Filter);
  if (filter === undefined) return 'none';
  if (filter instanceof PDFName) return filter;
  if (filter instanceof PDFArray && filter.size() === 1) {
    const only = doc.context.lookup(filter.get(0));
    return only instanceof PDFName ? only : null;
  }
  return null;
}

// Anzahl der Farbkanäle (1 oder 3) bei Grau, RGB oder ICC-Profil; sonst null (CMYK, Lab, indiziert …)
function components(doc: PDFDocument, dict: PDFDict): number | null {
  const space = dict.lookup(NAME.ColorSpace);
  if (space === NAME.DeviceRGB) return 3;
  if (space === NAME.DeviceGray) return 1;
  if (space instanceof PDFArray && doc.context.lookup(space.get(0)) === NAME.ICCBased) {
    const profile = doc.context.lookup(space.get(1));
    const n = profile instanceof PDFRawStream ? number(profile.dict.lookup(NAME.N)) : null;
    return n === 1 || n === 3 ? n : null;
  }
  return null;
}

async function decodeImage(doc: PDFDocument, stream: PDFRawStream, codec: ImageCodec): Promise<DecodedImage | null> {
  const { dict } = stream;
  const width = number(dict.lookup(NAME.Width));
  const height = number(dict.lookup(NAME.Height));
  const channels = components(doc, dict);
  const filter = singleFilter(doc, dict);
  if (!width || !height || !channels || number(dict.lookup(NAME.BitsPerComponent)) !== 8) return null;
  if (dict.lookup(NAME.ImageMask) !== undefined || dict.lookup(NAME.Decode) !== undefined || dict.lookup(NAME.Mask) instanceof PDFArray) return null;
  if (filter === NAME.DCTDecode) {
    const decoded = await codec.decodeJpeg(stream.contents);
    return decoded.width === width && decoded.height === height ? decoded : null;
  }
  if (filter !== NAME.FlateDecode) return null;
  let samples: Uint8Array = decodePDFRawStream(stream).decode();
  const parms = dict.lookup(NAME.DecodeParms);
  const predictor = parms instanceof PDFDict ? (number(parms.lookup(NAME.Predictor)) ?? 1) : 1;
  if (predictor >= 10) {
    if (parms instanceof PDFDict && ((number(parms.lookup(NAME.Colors)) ?? 1) !== channels || (number(parms.lookup(NAME.Columns)) ?? 1) !== width)) return null;
    const unpredicted = unpredictPng(samples, width, channels);
    if (!unpredicted) return null;
    samples = unpredicted;
  } else if (predictor !== 1) {
    return null;
  }
  if (samples.length < width * height * channels) return null;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const s = i * channels;
    rgba[o] = samples[s] as number;
    rgba[o + 1] = samples[channels === 3 ? s + 1 : s] as number;
    rgba[o + 2] = samples[channels === 3 ? s + 2 : s] as number;
    rgba[o + 3] = 255;
  }
  return { width, height, rgba };
}

async function recompressImage(doc: PDFDocument, ref: PDFRef, stream: PDFRawStream, maxSide: number, quality: number, codec: ImageCodec): Promise<boolean> {
  const decoded = await decodeImage(doc, stream, codec).catch(() => null);
  if (!decoded || decoded.width * decoded.height < MIN_IMAGE_PIXELS) return false;
  const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const image = scale < 1 ? { width, height, rgba: downsample(decoded.rgba, decoded.width, decoded.height, width, height) } : decoded;
  const jpeg = await codec.encodeJpeg(image, quality);
  if (jpeg.length >= stream.contents.length * MIN_SAVING) return false;
  const dict = doc.context.obj({}) as PDFDict;
  for (const [key, value] of stream.dict.entries()) if (!REPLACED.has(key.asString().slice(1))) dict.set(key, value);
  dict.set(NAME.Width, PDFNumber.of(width));
  dict.set(NAME.Height, PDFNumber.of(height));
  dict.set(NAME.BitsPerComponent, PDFNumber.of(8));
  // JPEG aus dem Browser ist immer RGB; ein RGB-Profil bleibt, Grau wird zu RGB
  dict.set(NAME.ColorSpace, components(doc, stream.dict) === 3 ? (stream.dict.get(NAME.ColorSpace) as PDFObject) : NAME.DeviceRGB);
  dict.set(NAME.Filter, NAME.DCTDecode);
  doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
  return true;
}

export interface CompressResult {
  bytes: Uint8Array;
  images: number;
}

export async function compressDocument(bytes: Uint8Array, level: CompressionLevel, codec: ImageCodec): Promise<CompressResult> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new CompressError('Komprimieren in verschlüsselten Dokumenten');
  const settings = COMPRESSION_LEVELS[level];
  // Größte Bildseite, die auf der größten Seite des Dokuments noch die Auflösung der Stufe hat
  const longest = Math.max(...doc.getPages().map((page) => Math.max(page.getWidth(), page.getHeight())), 1);
  const maxSide = Math.round((longest / 72) * settings.dpi);

  // Nur erreichbare Objekte; nicht mehr benutzte verschwinden beim Speichern
  const keep = reachable(doc);
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!keep.has(refKey(ref))) doc.context.delete(ref);

  let images = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const { dict } = object;
    if (dict.lookup(NAME.Subtype) === NAME.Image) {
      if (await recompressImage(doc, ref, object, maxSide, settings.quality, codec)) images++;
      continue;
    }
    // Ungepackte Ströme (Seiteninhalt, Schriften …) packen
    if (singleFilter(doc, dict) !== 'none' || object.contents.length < 64) continue;
    const packed = doc.context.flateStream(object.contents);
    for (const [key, value] of dict.entries()) if (key !== NAME.Length) packed.dict.set(key, value);
    if (packed.contents.length < object.contents.length) doc.context.assign(ref, packed);
  }
  const output = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: output, images };
}
