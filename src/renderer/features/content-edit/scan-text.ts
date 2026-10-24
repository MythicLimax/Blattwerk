// Text in einem Bild bearbeitbar machen (wie „Scans bearbeiten“ in Acrobat): den Bildbereich mit 300 dpi zeichnen,
// Text erkennen (tesseract.js, ADR 0015), jede erkannte Zeile mit einer Fläche in Hintergrundfarbe abdecken und als
// echten Text in ähnlicher Größe und Farbe darübersetzen. Die Bildpunkte darunter bleiben im Bild erhalten (für
// vertrauliche Inhalte: Schwärzen). Nur auf ungedrehten Seiten.
import type { Rect, Rgb } from '../../../shared/annotations';
import type { ContentOperation, EditUnit } from '../../../shared/content';
import { boldLines, linesFromBlocks, rgbaToPgm, type OcrTextLine } from '../../../shared/ocr';
import type { ImageSource } from '../../../shared/pages';
import { startOcr, type OcrEngine } from '../../engine/ocr-client';
import { closeSession, openSession, renderPage } from '../../engine/pdfium-client';
import { getRuntime } from '../../engine/runtime';
import { applyContentOperations, pendingChanges } from '../../engine/session';
import { t } from '../../i18n';
import type { TabState } from '../../state/documents-store';
import { useUi } from '../../state/ui-store';
import { OCR_DPI } from '../ocr/actions';
import { busy } from '../pages/actions';

interface Pixels {
  data: Uint8Array;
  width: number;
  height: number;
}

const luminance = (data: Uint8Array, i: number) => (data[i] as number) * 0.299 + (data[i + 1] as number) * 0.587 + (data[i + 2] as number) * 0.114;

// Farben einer Zeile: Hintergrund aus einem Ring knapp außerhalb (fette Schrift verfälscht ihn innen nicht), Schrift
// aus den dunkelsten Bildpunkten innen; dazu die Strichstärke (für fett, siehe boldLines)
function lineLook(image: Pixels, [x0, y0, x1, y1]: [number, number, number, number], ring: number): { background: Rgb; ink: Rgb; stroke: number } {
  const inside: number[] = [];
  const around: number[] = [];
  const left = Math.floor(x0);
  const top = Math.floor(y0);
  const right = Math.ceil(x1);
  const bottom = Math.ceil(y1);
  for (let y = Math.max(0, top - ring); y < Math.min(image.height, bottom + ring); y++) {
    for (let x = Math.max(0, left - ring); x < Math.min(image.width, right + ring); x++) {
      const i = (y * image.width + x) * 4;
      if (x >= left && x < right && y >= top && y < bottom) inside.push(i);
      else around.push(i);
    }
  }
  const average = (list: number[]): Rgb => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const i of list) {
      r += image.data[i] as number;
      g += image.data[i + 1] as number;
      b += image.data[i + 2] as number;
    }
    return list.length > 0 ? { r: r / list.length / 255, g: g / list.length / 255, b: b / list.length / 255 } : { r: 1, g: 1, b: 1 };
  };
  // Ring: die hellere Hälfte (einzelne Striche benachbarter Zeilen fallen heraus)
  const ringSorted = [...around].sort((a, b) => luminance(image.data, b) - luminance(image.data, a));
  const background = average(ringSorted.slice(0, Math.max(1, Math.ceil(ringSorted.length / 2))));
  const paper = luminance(new Uint8Array([background.r * 255, background.g * 255, background.b * 255]), 0);
  const sorted = [...inside].sort((a, b) => luminance(image.data, a) - luminance(image.data, b));
  const darkest = sorted.length > 0 ? luminance(image.data, sorted[0] as number) : 0;
  const threshold = (paper + darkest) / 2;
  const inked = sorted.filter((i) => luminance(image.data, i) < threshold);
  const ink = average(inked.slice(0, Math.max(1, Math.round(inked.length * 0.5))));
  // Strichstärke: mittlere Länge waagerechter Läufe dunkler Bildpunkte im mittleren Band, im Verhältnis zur Zeilenhöhe
  let runs = 0;
  let inkPixels = 0;
  for (let y = Math.round(top + (bottom - top) * 0.35); y < Math.round(top + (bottom - top) * 0.65); y++) {
    let inRun = false;
    for (let x = left; x < right; x++) {
      const dark = x >= 0 && x < image.width && y >= 0 && y < image.height && luminance(image.data, (y * image.width + x) * 4) < threshold;
      if (dark) inkPixels++;
      if (dark && !inRun) runs++;
      inRun = dark;
    }
  }
  const stroke = runs > 0 ? inkPixels / runs / Math.max(1, bottom - top) : 0;
  return { background, ink, stroke };
}

// Einfarbige Fläche als 1×1-PNG (gestreckt auf das Rechteck; „Bild einfügen“ des Workers)
async function solid(color: Rgb): Promise<ImageSource> {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('kein Zeichenkontext');
  context.fillStyle = `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`;
  context.fillRect(0, 0, 1, 1);
  const data = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  return { kind: 'png', data, width: 1, height: 1, rotation: 0 };
}

// Schriftgröße so, dass die Zeile in Helvetica etwa so breit wird wie im Bild (höchstens so groß wie gemessen)
function fittedSize(text: string, height: number, width: number, bold: boolean): number {
  const canvas = new OffscreenCanvas(1, 1);
  const context = canvas.getContext('2d');
  if (!context) return height;
  context.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
  const measured = context.measureText(text).width / 100;
  return measured > 0 ? Math.max(4, Math.min(height, width / measured)) : height;
}

export async function makeImageTextEditable(tab: TabState, pageIndex: number, unit: EditUnit): Promise<boolean> {
  const ui = useUi.getState();
  const runtime = getRuntime(tab.id);
  if (!runtime?.pdf || unit.kind !== 'image') return false;
  const page = await runtime.pdf.getPage(pageIndex + 1);
  if (page.rotate % 360 !== 0) {
    ui.notify(t('contentEdit.scanRotated'));
    return false;
  }
  const [boxLeft = 0, , , boxTop = 0] = page.view;
  let engine: OcrEngine | null = null;
  let session: number | null = null;
  try {
    const operations = await busy('contentEdit.scanBusy', async () => {
      const opened = await openSession(await runtime.pdf!.getData(), runtime.password, await pendingChanges(tab.id));
      session = opened.session;
      const rendered = await renderPage(opened.session, pageIndex, OCR_DPI, 'rgba');
      const scale = rendered.dpi / 72;
      // Bildbereich in Bildpunkten der gezeichneten Seite
      const [l, b, r, top] = unit.bounds;
      const cx0 = Math.max(0, Math.floor((l - boxLeft) * scale));
      const cy0 = Math.max(0, Math.floor((boxTop - top) * scale));
      const cx1 = Math.min(rendered.width, Math.ceil((r - boxLeft) * scale));
      const cy1 = Math.min(rendered.height, Math.ceil((boxTop - b) * scale));
      const width = cx1 - cx0;
      const height = cy1 - cy0;
      if (width < 8 || height < 8) return [];
      const crop = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) crop.set(rendered.bytes.subarray(((cy0 + y) * rendered.width + cx0) * 4, ((cy0 + y) * rendered.width + cx1) * 4), y * width * 4);
      engine = await startOcr(['deu', 'eng']);
      const lines: OcrTextLine[] = linesFromBlocks(await engine.recognize(rgbaToPgm(crop, width, height)));
      const image: Pixels = { data: crop, width, height };
      const toPdfX = (x: number) => boxLeft + (cx0 + x) / scale;
      const toPdfY = (y: number) => boxTop - (cy0 + y) / scale;
      const covers: ContentOperation[] = [];
      const texts: ContentOperation[] = [];
      const looks = lines.map((line) => lineLook(image, line.box, Math.max(2, Math.round(3 * scale))));
      const bolds = boldLines(looks.map((look) => look.stroke));
      for (const [k, line] of lines.entries()) {
        const [x0, y0, x1, y1] = line.box;
        const pad = 1.5 * scale;
        const { background, ink } = looks[k] as (typeof looks)[number];
        const bold = bolds[k] === true;
        const rect: Rect = [toPdfX(x0 - pad), toPdfY(y1 + pad), toPdfX(x1 + pad), toPdfY(y0 - pad)];
        covers.push({ type: 'addImage', pageIndex, rect, image: await solid(background) });
        const size = fittedSize(line.text, line.size / scale, (x1 - x0) / scale, bold);
        texts.push({ type: 'addText', pageIndex, origin: { x: toPdfX(x0), y: toPdfY(line.baseline) }, lines: [line.text], font: bold ? 'HelveticaBold' : 'Helvetica', size, color: ink });
      }
      return [...covers, ...texts];
    });
    if (operations.length === 0) {
      ui.confirm(t('contentEdit.scanNothing'));
      return false;
    }
    const done = await applyContentOperations(tab.id, operations, { keepScroll: true });
    if (done) ui.confirm(t('contentEdit.scanDone', { count: operations.length / 2 }));
    return done;
  } catch (error) {
    ui.notify(t('contentEdit.scanFailed'), error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    const finished = engine as OcrEngine | null;
    if (finished) await finished.stop().catch(() => undefined);
    if (session !== null) await closeSession(session);
  }
}
