// Erzeugt das Bild einer Unterschrift (PNG mit durchsichtigem Hintergrund, eng zugeschnitten).
export interface SignaturePng {
  png: Uint8Array;
  width: number;
  height: number;
}

export interface StrokePoint {
  x: number;
  y: number;
}

// Größte Breite des gespeicherten Bildes (scharf genug für den Druck, klein genug für die Datei)
const MAX_WIDTH = 1200;
const PADDING = 8;

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG lässt sich nicht erzeugen');
  return new Uint8Array(await blob.arrayBuffer());
}

// Schneidet auf den nicht durchsichtigen Bereich zu (mit kleinem Rand).
function cropToContent(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const { width, height } = source;
  const data = context.getImageData(0, 0, width, height).data;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const x0 = Math.max(0, left - PADDING);
  const y0 = Math.max(0, top - PADDING);
  const x1 = Math.min(width, right + PADDING + 1);
  const y1 = Math.min(height, bottom + PADDING + 1);
  const scale = Math.min(1, MAX_WIDTH / (x1 - x0));
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.round((x1 - x0) * scale));
  result.height = Math.max(1, Math.round((y1 - y0) * scale));
  result.getContext('2d')?.drawImage(source, x0, y0, x1 - x0, y1 - y0, 0, 0, result.width, result.height);
  return result;
}

async function finish(canvas: HTMLCanvasElement): Promise<SignaturePng | null> {
  const cropped = cropToContent(canvas);
  if (!cropped) return null;
  return { png: await canvasToPng(cropped), width: cropped.width, height: cropped.height };
}

// Gezeichnete Striche (Koordinaten im Zeichenfeld) in doppelter Auflösung
export async function strokesToPng(strokes: StrokePoint[][], size: { width: number; height: number }, color: string): Promise<SignaturePng | null> {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size.width * scale;
  canvas.height = size.height * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of strokes) {
    const [first, ...rest] = stroke;
    if (!first) continue;
    context.beginPath();
    context.moveTo(first.x, first.y);
    if (rest.length === 0) context.lineTo(first.x + 0.1, first.y);
    for (const point of rest) context.lineTo(point.x, point.y);
    context.stroke();
  }
  return finish(canvas);
}

// Getippter Name in einer Schreibschrift des Systems
export async function textToPng(text: string, fontFamily: string, color: string): Promise<SignaturePng | null> {
  const value = text.trim();
  if (!value) return null;
  const fontSize = 120;
  const font = `${fontSize}px ${fontFamily}`;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = font;
  const width = Math.ceil(measure.measureText(value).width + fontSize);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(width, 4000);
  canvas.height = Math.round(fontSize * 2);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'middle';
  context.fillText(value, fontSize / 2, canvas.height / 2);
  return finish(canvas);
}

// Bild (JPEG/PNG) als Unterschrift; auf Wunsch wird ein heller Hintergrund durchsichtig.
export async function imageToPng(bytes: Uint8Array, removeBackground: boolean): Promise<SignaturePng | null> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  const scale = Math.min(1, (MAX_WIDTH * 2) / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  if (removeBackground) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
      const luminance = (0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255;
      // Weiß wird durchsichtig, Hellgrau halbdurchsichtig (weicher Rand), dunkle Striche bleiben.
      if (luminance > 0.85) data[i + 3] = Math.round((data[i + 3] ?? 255) * Math.max(0, (0.95 - luminance) / 0.1));
    }
    context.putImageData(image, 0, 0);
  }
  return finish(canvas);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
