// Wasserzeichen, Kopf- und Fußzeilen, Seitenzahlen (Phase 5) mit @cantoo/pdf-lib. Siehe docs/entscheidungen/0009-wasserzeichen.md.
//
// Jede Ergänzung ist ein eigener Inhaltsstrom der Seite; der vorhandene Inhalt bleibt Byte für Byte unverändert
// (PDFium würde beim Hinzufügen den ganzen Seiteninhalt neu schreiben). Die Ströme tragen im Wörterbuch die Kennung
// /BlattwerkArtifact, damit „Entfernen“ genau sie findet, und im Inhalt /Artifact-Marken (Pagination), wie Acrobat sie
// für Wasserzeichen und Kopfzeilen schreibt. Gespeichert wird inkrementell.
import fontkit from '@cantoo/fontkit';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, StandardFonts, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import { embeddingAllowed, isSystemFontKey, type TextFont } from '../../shared/fonts';
import {
  expandTokens,
  visualToUser,
  type ArtifactKind,
  type HeaderFooterSpec,
  type HeaderFooterTexts,
  type StampFont,
  type StampOperation,
  type WatermarkSpec,
} from '../../shared/stamping';

export type StampErrorCode = 'stamp-encrypted' | 'stamp-characters' | 'stamp-nothing' | 'stamp-image' | 'stamp-font';

export class StampError extends Error {
  constructor(
    readonly code: StampErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StampError';
  }
}

const MARKER = PDFName.of('BlattwerkArtifact');
const MARKER_VALUE: Record<ArtifactKind | 'wrap', string> = { watermark: 'Watermark', headerFooter: 'HeaderFooter', wrap: 'Wrap' };

const FONTS: Record<StampFont, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  HelveticaBold: StandardFonts.HelveticaBold,
  TimesRoman: StandardFonts.TimesRoman,
  TimesRomanBold: StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
};

// Abstand zum Rand bei Ausrichtung links/rechts bzw. oben/unten (Wasserzeichen)
const EDGE = 36;
// Höhe der Großbuchstaben im Verhältnis zur Schriftgröße (für die Mitte des Textes)
const CAP_HEIGHT = 0.7;

// Zahl im PDF-Format (ohne Exponent, höchstens drei Nachkommastellen)
function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

const matrix = (values: readonly number[]) => values.map(n).join(' ');

function targetPages(doc: PDFDocument, pages: number[] | null): number[] {
  const count = doc.getPageCount();
  const list = pages === null ? Array.from({ length: count }, (_, i) => i) : [...new Set(pages)].filter((p) => p >= 0 && p < count);
  return list.sort((a, b) => a - b);
}

function visual(page: PDFPage) {
  // pdf-lib fasst sonst bei jeder Bearbeitung den ganzen Inhalt erneut in q … Q (Verschachtelung wüchse mit jedem
  // Schritt); das übernimmt #attach mit eigenen, wieder entfernbaren Hüllen.
  (page.node as unknown as { autoNormalizeCTM: boolean }).autoNormalizeCTM = false;
  const crop = page.getCropBox();
  return visualToUser(crop, page.getRotation().angle);
}

class Stamper {
  readonly #doc: PDFDocument;
  readonly #fonts = new Map<TextFont, PDFFont>();
  #wrap: { start: PDFRef; end: PDFRef } | null = null;

  constructor(doc: PDFDocument) {
    this.#doc = doc;
  }

  // Standardschrift (nicht eingebettet) oder Schrift des Rechners (als Teilschrift eingebettet, ADR 0024)
  async #font(font: TextFont, data?: ArrayBuffer): Promise<PDFFont> {
    let embedded = this.#fonts.get(font);
    if (!embedded) {
      if (isSystemFontKey(font)) {
        const bytes = data ? new Uint8Array(data) : null;
        if (!bytes) throw new StampError('stamp-font', `Schriftdaten fehlen: ${font}`);
        if (!embeddingAllowed(bytes)) throw new StampError('stamp-font', `Einbetten nicht erlaubt: ${font}`);
        this.#doc.registerFontkit(fontkit);
        embedded = await this.#doc.embedFont(bytes, { subset: true });
      } else {
        embedded = await this.#doc.embedFont(FONTS[font]);
      }
      this.#fonts.set(font, embedded);
    }
    return embedded;
  }

  // pdf-lib ersetzt Zeichen, die die Standardschrift nicht kennt, stillschweigend durch „?“; hier werden sie gemeldet.
  #encode(font: PDFFont, text: string): string {
    const supported = new Set(font.getCharacterSet());
    const unsupported = [...new Set([...text])].filter((char) => !supported.has(char.codePointAt(0) ?? 0));
    if (unsupported.length > 0) throw new StampError('stamp-characters', unsupported.join(''));
    return font.encodeText(text).toString();
  }

  #stream(kind: ArtifactKind | 'wrap', content: string): PDFRef {
    const context = this.#doc.context;
    return context.register(context.flateStream(content, { BlattwerkArtifact: MARKER_VALUE[kind] }));
  }

  // Inhalt vorn (über dem Seiteninhalt) oder hinten anfügen. Vorn wird der vorhandene Inhalt in q … Q gefasst, damit
  // dessen Grafikzustand (z. B. eine verschobene Ursprungslage) das Wasserzeichen nicht verschiebt.
  #attach(page: PDFPage, ref: PDFRef, behind: boolean): void {
    const node = page.node;
    const current = node.get(PDFName.of('Contents'));
    const existing = current instanceof PDFArray ? current.asArray() : current ? [current] : [];
    if (behind) {
      node.set(PDFName.of('Contents'), this.#doc.context.obj([ref, ...existing]));
      return;
    }
    this.#wrap ??= { start: this.#stream('wrap', 'q\n'), end: this.#stream('wrap', 'Q\n') };
    node.set(PDFName.of('Contents'), this.#doc.context.obj([this.#wrap.start, ...existing, this.#wrap.end, ref]));
  }

  #opacityState(page: PDFPage, opacity: number): string {
    const state = this.#doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity });
    return page.node.newExtGState('BwGS', state).asString();
  }

  async watermark(spec: WatermarkSpec): Promise<void> {
    const pages = targetPages(this.#doc, spec.pages);
    const angle = (spec.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    if (spec.kind === 'text') {
      const text = spec.text.trim();
      if (!text) return;
      const font = await this.#font(spec.font, spec.fontData);
      const hex = this.#encode(font, text);
      const widthAt1 = font.widthOfTextAtSize(text, 1);
      for (const index of pages) {
        const page = this.#doc.getPage(index);
        const view = visual(page);
        const size =
          spec.size > 0
            ? spec.size
            : Math.min(
                400,
                (view.width * 0.8) / (widthAt1 * Math.abs(cos) + CAP_HEIGHT * Math.abs(sin)),
                (view.height * 0.8) / (widthAt1 * Math.abs(sin) + CAP_HEIGHT * Math.abs(cos)),
              );
        const width = widthAt1 * size;
        const height = CAP_HEIGHT * size;
        const center = this.#anchor(view, spec, width, height, cos, sin);
        // Ursprung des Textes so, dass seine Mitte im Ankerpunkt liegt
        const ox = center.x - (cos * width) / 2 + (sin * height) / 2;
        const oy = center.y - (sin * width) / 2 - (cos * height) / 2;
        const fontName = page.node.newFontDictionary('BwF', font.ref).asString();
        const gs = this.#opacityState(page, spec.opacity);
        const { r, g, b } = spec.color;
        const content = [
          'q',
          `${matrix(view.matrix)} cm`,
          '/Artifact <</Type /Pagination /Subtype /Watermark>> BDC',
          `${gs} gs`,
          `${n(r)} ${n(g)} ${n(b)} rg`,
          'BT',
          `${fontName} ${n(size)} Tf`,
          `${matrix([cos, sin, -sin, cos, ox, oy])} Tm`,
          `${hex} Tj`,
          'ET',
          'EMC',
          'Q',
        ].join('\n');
        this.#attach(page, this.#stream('watermark', content), spec.behind);
      }
      return;
    }
    let image;
    try {
      image = spec.image.kind === 'jpeg' ? await this.#doc.embedJpg(spec.image.data) : await this.#doc.embedPng(spec.image.data);
    } catch (error) {
      throw new StampError('stamp-image', error instanceof Error ? error.message : String(error));
    }
    // Handyfotos: EXIF-Drehung im Uhrzeigersinn ausgleichen
    const exif = spec.image.rotation;
    const swapped = exif === 90 || exif === 270;
    const total = angle - (exif * Math.PI) / 180;
    const tcos = Math.cos(total);
    const tsin = Math.sin(total);
    for (const index of pages) {
      const page = this.#doc.getPage(index);
      const view = visual(page);
      const displayWidth = (Math.max(1, Math.min(100, spec.scale)) / 100) * view.width;
      const k = displayWidth / (swapped ? image.height : image.width);
      const w = image.width * k;
      const h = image.height * k;
      // Aufrechte Größe (nach EXIF) für die Ausrichtung
      const upright = swapped ? { w: h, h: w } : { w, h };
      const center = this.#anchor(view, spec, upright.w, upright.h, cos, sin);
      const ox = center.x - (tcos * w) / 2 + (tsin * h) / 2;
      const oy = center.y - (tsin * w) / 2 - (tcos * h) / 2;
      const name = page.node.newXObject('BwIm', image.ref).asString();
      const gs = this.#opacityState(page, spec.opacity);
      const content = [
        'q',
        `${matrix(view.matrix)} cm`,
        '/Artifact <</Type /Pagination /Subtype /Watermark>> BDC',
        `${gs} gs`,
        `${matrix([tcos * w, tsin * w, -tsin * h, tcos * h, ox, oy])} cm`,
        `${name} Do`,
        'EMC',
        'Q',
      ].join('\n');
      this.#attach(page, this.#stream('watermark', content), spec.behind);
    }
  }

  // Mittelpunkt des (gedrehten) Wasserzeichens auf der angezeigten Seite
  #anchor(
    view: { width: number; height: number },
    spec: Pick<WatermarkSpec, 'horizontal' | 'vertical'>,
    width: number,
    height: number,
    cos: number,
    sin: number,
  ): { x: number; y: number } {
    const bw = Math.abs(width * cos) + Math.abs(height * sin);
    const bh = Math.abs(width * sin) + Math.abs(height * cos);
    const x = spec.horizontal === 'left' ? EDGE + bw / 2 : spec.horizontal === 'right' ? view.width - EDGE - bw / 2 : view.width / 2;
    const y = spec.vertical === 'bottom' ? EDGE + bh / 2 : spec.vertical === 'top' ? view.height - EDGE - bh / 2 : view.height / 2;
    return { x, y };
  }

  async headerFooter(spec: HeaderFooterSpec): Promise<void> {
    const pages = targetPages(this.#doc, spec.pages);
    if (pages.length === 0) return;
    const font = await this.#font(spec.font, spec.fontData);
    const first = pages[0] as number;
    const last = pages.at(-1) as number;
    const total = spec.startNumber + (last - first);
    const slots: Array<{ key: keyof HeaderFooterTexts; header: boolean; align: 'left' | 'center' | 'right' }> = [
      { key: 'headerLeft', header: true, align: 'left' },
      { key: 'headerCenter', header: true, align: 'center' },
      { key: 'headerRight', header: true, align: 'right' },
      { key: 'footerLeft', header: false, align: 'left' },
      { key: 'footerCenter', header: false, align: 'center' },
      { key: 'footerRight', header: false, align: 'right' },
    ];
    const used = slots.filter((slot) => spec.texts[slot.key].trim() !== '');
    if (used.length === 0) return;
    const { r, g, b } = spec.color;
    for (const index of pages) {
      const page = this.#doc.getPage(index);
      const view = visual(page);
      const fontName = page.node.newFontDictionary('BwF', font.ref).asString();
      const values = { page: spec.startNumber + (index - first), pages: total, date: spec.date, file: spec.fileName };
      const blocks: string[] = [];
      for (const header of [true, false]) {
        const lines = used.filter((slot) => slot.header === header);
        if (lines.length === 0) continue;
        blocks.push(`/Artifact <</Type /Pagination /Subtype /${header ? 'Header' : 'Footer'}>> BDC`, 'BT', `${fontName} ${n(spec.size)} Tf`);
        for (const slot of lines) {
          const text = expandTokens(spec.texts[slot.key], values);
          const hex = this.#encode(font, text);
          const width = font.widthOfTextAtSize(text, spec.size);
          const x = slot.align === 'left' ? spec.margins.left : slot.align === 'right' ? view.width - spec.margins.right - width : (view.width - width) / 2;
          const y = header ? view.height - spec.margins.top - spec.size * CAP_HEIGHT : spec.margins.bottom;
          blocks.push(`1 0 0 1 ${n(x)} ${n(y)} Tm`, `${hex} Tj`);
        }
        blocks.push('ET', 'EMC');
      }
      const content = ['q', `${matrix(view.matrix)} cm`, `${n(r)} ${n(g)} ${n(b)} rg`, ...blocks, 'Q'].join('\n');
      this.#attach(page, this.#stream('headerFooter', content), false);
    }
  }

  // Entfernt die eigenen Ströme einer Art; ohne verbleibende eigene Ströme auch die q/Q-Hüllen. Liefert die Anzahl.
  remove(kind: ArtifactKind): number {
    let removed = 0;
    for (const page of this.#doc.getPages()) {
      const current = page.node.get(PDFName.of('Contents'));
      if (!(current instanceof PDFArray)) continue;
      const entries = current.asArray();
      const kindOf = (entry: unknown): string | null => {
        const stream = entry instanceof PDFRef ? this.#doc.context.lookup(entry) : null;
        const value = stream instanceof PDFRawStream ? stream.dict.get(MARKER) : undefined;
        return value instanceof PDFName ? value.decodeText() : null;
      };
      let kept = entries.filter((entry) => kindOf(entry) !== MARKER_VALUE[kind]);
      removed += entries.length - kept.length;
      if (!kept.some((entry) => kindOf(entry) === MARKER_VALUE.watermark || kindOf(entry) === MARKER_VALUE.headerFooter)) {
        kept = kept.filter((entry) => kindOf(entry) !== MARKER_VALUE.wrap);
      }
      if (kept.length !== entries.length) page.node.set(PDFName.of('Contents'), this.#doc.context.obj(kept));
    }
    return removed;
  }
}

export async function applyStampOperations(bytes: Uint8Array, operations: StampOperation[]): Promise<Uint8Array> {
  if (operations.length === 0) return bytes;
  const doc = await PDFDocument.load(bytes, {
    forIncrementalUpdate: true,
    updateMetadata: false,
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  // Neue Ströme würden unverschlüsselt geschrieben (siehe fields.ts)
  if (doc.isEncrypted) throw new StampError('stamp-encrypted', 'Verschlüsseltes Dokument');
  const stamper = new Stamper(doc);
  for (const operation of operations) {
    switch (operation.type) {
      case 'addWatermark':
        if (operation.replace) stamper.remove('watermark');
        await stamper.watermark(operation.spec);
        break;
      case 'addHeaderFooter':
        if (operation.replace) stamper.remove('headerFooter');
        await stamper.headerFooter(operation.spec);
        break;
      case 'removeArtifacts':
        if (stamper.remove(operation.kind) === 0) throw new StampError('stamp-nothing', operation.kind);
        break;
    }
  }
  return doc.commit({ useObjectStreams: false });
}
