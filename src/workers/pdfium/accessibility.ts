// Barrierefreiheit (Phase 7, ADR 0018) mit @cantoo/pdf-lib: Tag-Struktur auslesen, wichtige Regeln prüfen (angelehnt an
// PDF/UA und die Schnellprüfung von Acrobat) und einfache Mängel beheben. Erwartet ein unverschlüsseltes Dokument
// (PDFium entfernt vorher den Kennwortschutz).
import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  type PDFObject,
} from '@cantoo/pdf-lib';
import type { AccessibilityCheck, AccessibilityFix, AccessibilityReport, TagNode } from '../../shared/accessibility';

const N = (name: string) => PDFName.of(name);
const MAX_NODES = 20_000;
const MAX_DEPTH = 200;
const nameOf = (value: PDFObject | undefined): string | null => (value instanceof PDFName ? value.decodeText() : null);
const textOf = (value: PDFObject | undefined): string | null => {
  const text = value instanceof PDFString || value instanceof PDFHexString ? value.decodeText().trim() : '';
  return text.length > 0 ? text : null;
};

function infoTitle(doc: PDFDocument): string | null {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    const title = textOf(info.lookup(N('Title')));
    if (title) return title;
  }
  const metadata = doc.catalog.lookup(N('Metadata'));
  if (metadata instanceof PDFRawStream) {
    try {
      const xml = new TextDecoder().decode(decodePDFRawStream(metadata).decode());
      const title = /<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)<\/rdf:li>/.exec(xml)?.[1]?.trim();
      if (title) return title;
    } catch {
      // nicht lesbare Metadaten
    }
  }
  return null;
}

class TreeReader {
  readonly pageIndex = new Map<PDFRef, number>();
  readonly roleMap = new Map<string, string>();
  nodes = 0;
  truncated = false;
  readonly figures: TagNode[] = [];
  readonly headings: number[] = [];
  readonly tables: TagNode[] = [];
  // Element-Wörterbücher nach TagNode.id
  readonly dicts: PDFDict[] = [];

  constructor(private readonly doc: PDFDocument) {
    doc.getPages().forEach((page, i) => this.pageIndex.set(page.ref, i));
    const root = doc.catalog.lookup(N('StructTreeRoot'));
    const roleMap = root instanceof PDFDict ? root.lookup(N('RoleMap')) : null;
    if (roleMap instanceof PDFDict) for (const [key, value] of roleMap.entries()) if (value instanceof PDFName) this.roleMap.set(key.decodeText(), value.decodeText());
  }

  standardRole(role: string): string {
    let current = role;
    for (let i = 0; i < 10 && this.roleMap.has(current); i++) current = this.roleMap.get(current) as string;
    return current;
  }

  page(value: PDFObject | undefined): number | null {
    return value instanceof PDFRef ? (this.pageIndex.get(value) ?? null) : null;
  }

  // Kinder eines Elements: Unterelemente und Zähler für Inhalte (MCID, MCR, OBJR)
  read(kids: PDFObject | undefined, depth: number, seen: Set<PDFObject>): { children: TagNode[]; contents: number; page: number | null } {
    const children: TagNode[] = [];
    let contents = 0;
    let page: number | null = null;
    const items = kids instanceof PDFArray ? kids.asArray() : kids ? [kids] : [];
    for (const item of items) {
      if (item instanceof PDFNumber) {
        contents++;
        continue;
      }
      const dict = this.doc.context.lookup(item);
      if (!(dict instanceof PDFDict)) continue;
      const type = nameOf(dict.get(N('Type')));
      if (type === 'MCR' || type === 'OBJR') {
        contents++;
        page ??= this.page(dict.get(N('Pg')));
        continue;
      }
      const node = this.element(dict, depth + 1, seen);
      if (node) {
        children.push(node);
        page ??= node.pageIndex;
      }
    }
    return { children, contents, page };
  }

  element(dict: PDFDict, depth: number, seen: Set<PDFObject>): TagNode | null {
    if (seen.has(dict) || depth > MAX_DEPTH) return null;
    if (this.nodes >= MAX_NODES) {
      this.truncated = true;
      return null;
    }
    seen.add(dict);
    const id = this.nodes++;
    this.dicts[id] = dict;
    const custom = nameOf(dict.get(N('S'))) ?? '?';
    const role = this.standardRole(custom);
    const node: TagNode = {
      id,
      role,
      customRole: role !== custom ? custom : null,
      title: textOf(dict.lookup(N('T'))),
      alt: textOf(dict.lookup(N('Alt'))),
      actualText: textOf(dict.lookup(N('ActualText'))),
      lang: textOf(dict.lookup(N('Lang'))),
      pageIndex: this.page(dict.get(N('Pg'))),
      contents: 0,
      children: [],
    };
    // Reihenfolge der Überschriften im Lesefluss (vor den Kindern)
    const heading = /^H([1-6])$/.exec(role);
    if (heading) this.headings.push(Number(heading[1]));
    const { children, contents, page } = this.read(dict.get(N('K')), depth, seen);
    node.children = children;
    node.contents = contents;
    node.pageIndex ??= page;
    if (role === 'Figure') this.figures.push(node);
    if (role === 'Table') this.tables.push(node);
    return node;
  }
}

const hasRole = (node: TagNode, role: string): boolean => node.children.some((child) => child.role === role || hasRole(child, role));

// Seiten, die nur Bilder und keinen Text enthalten (z. B. Scans ohne Texterkennung)
function imageOnlyPages(doc: PDFDocument): number {
  let count = 0;
  const textIn = (bytes: Uint8Array) => /(^|[\s\])>])(Tj|TJ|'|")(?=[\s[<(/]|$)/m.test(new TextDecoder('latin1').decode(bytes));
  const streamsOf = (contents: PDFObject | undefined): Uint8Array[] => {
    const list = contents instanceof PDFArray ? contents.asArray().map((item) => doc.context.lookup(item)) : [contents];
    return list.filter((item): item is PDFRawStream => item instanceof PDFRawStream).map((stream) => {
      try {
        return decodePDFRawStream(stream).decode();
      } catch {
        return new Uint8Array();
      }
    });
  };
  for (const page of doc.getPages()) {
    const own = streamsOf(page.node.lookup(N('Contents')));
    let text = own.some(textIn);
    let images = false;
    const xobjects = page.node.Resources()?.lookup(N('XObject'));
    if (xobjects instanceof PDFDict) {
      for (const [, value] of xobjects.entries()) {
        const stream = doc.context.lookup(value);
        if (!(stream instanceof PDFRawStream)) continue;
        const subtype = nameOf(stream.dict.get(N('Subtype')));
        if (subtype === 'Image') images = true;
        else if (subtype === 'Form' && !text) text = streamsOf(stream).some(textIn);
      }
    }
    if (images && !text) count++;
  }
  return count;
}

function terminalFields(doc: PDFDocument): PDFDict[] {
  const acroForm = doc.catalog.lookup(N('AcroForm'));
  const fields = acroForm instanceof PDFDict ? acroForm.lookup(N('Fields')) : null;
  const result: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (items: PDFArray, depth: number) => {
    for (const item of items.asArray()) {
      const field = doc.context.lookup(item);
      if (!(field instanceof PDFDict) || seen.has(field) || depth > 50) continue;
      seen.add(field);
      const kids = field.lookup(N('Kids'));
      // Kinder mit eigenem Namen sind Felder, sonst nur Widgets
      const childFields = kids instanceof PDFArray ? kids.asArray().filter((kid) => { const dict = doc.context.lookup(kid); return dict instanceof PDFDict && dict.has(N('T')); }) : [];
      if (childFields.length > 0) visit(doc.context.obj(childFields), depth + 1);
      else result.push(field);
    }
  };
  if (fields instanceof PDFArray) visit(fields, 0);
  return result;
}

export async function checkAccessibility(bytes: Uint8Array): Promise<AccessibilityReport> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const root = doc.catalog.lookup(N('StructTreeRoot'));
  const markInfo = doc.catalog.lookup(N('MarkInfo'));
  const tagged = root instanceof PDFDict && markInfo instanceof PDFDict && markInfo.lookup(N('Marked')) === PDFBool.True;
  const reader = new TreeReader(doc);
  const tree = root instanceof PDFDict ? reader.read(root.get(N('K')), 0, new Set()).children : [];

  const lang = textOf(doc.catalog.lookup(N('Lang')));
  const title = infoTitle(doc);
  const preferences = doc.catalog.lookup(N('ViewerPreferences'));
  const displayTitle = preferences instanceof PDFDict && preferences.lookup(N('DisplayDocTitle')) === PDFBool.True;
  const pages = doc.getPages();
  let wrongTabs = 0;
  let untaggedAnnotations = 0;
  for (const page of pages) {
    const annots = page.node.lookup(N('Annots'));
    const list = annots instanceof PDFArray ? annots.asArray().map((item) => doc.context.lookup(item)).filter((item): item is PDFDict => item instanceof PDFDict) : [];
    const visible = list.filter((annot) => !['Popup'].includes(nameOf(annot.get(N('Subtype'))) ?? ''));
    if (visible.length > 0 && nameOf(page.node.lookup(N('Tabs'))) !== 'S') wrongTabs++;
    untaggedAnnotations += visible.filter((annot) => !annot.has(N('StructParent'))).length;
  }
  let headingJumps = 0;
  reader.headings.forEach((level, i) => {
    const previous = i === 0 ? 0 : (reader.headings[i - 1] as number);
    if (level > previous + 1) headingJumps++;
  });
  const fields = terminalFields(doc);
  const outlines = doc.catalog.lookup(N('Outlines'));
  const hasBookmarks = outlines instanceof PDFDict && outlines.has(N('First'));
  const figuresWithoutAlt = reader.figures.filter((figure) => !figure.alt && !figure.actualText).length;
  const tablesWithoutHeaders = reader.tables.filter((table) => !hasRole(table, 'TH')).length;
  const imageOnly = imageOnlyPages(doc);
  const encrypted = doc.isEncrypted;

  const result = (code: AccessibilityCheck['code'], failed: number | boolean, extra: Partial<AccessibilityCheck> = {}): AccessibilityCheck => ({
    code,
    status: failed ? 'failed' : 'passed',
    ...(typeof failed === 'number' && failed > 0 ? { count: failed } : {}),
    ...extra,
  });
  const structural = (code: AccessibilityCheck['code'], failed: number): AccessibilityCheck => (tagged ? result(code, failed) : { code, status: 'skipped' });
  const checks: AccessibilityCheck[] = [
    result('tagged', !tagged),
    result('language', !lang, { fixable: !encrypted }),
    result('title', !title, { fixable: !encrypted }),
    result('display-title', !displayTitle, { fixable: !encrypted }),
    result('tab-order', wrongTabs, { fixable: !encrypted }),
    structural('figure-alt', figuresWithoutAlt),
    structural('heading-order', headingJumps),
    structural('table-headers', tablesWithoutHeaders),
    structural('annotations-tagged', untaggedAnnotations),
    result('field-tooltip', fields.filter((field) => !textOf(field.lookup(N('TU')))).length),
    result('image-only', imageOnly),
    result('bookmarks', pages.length > 20 && !hasBookmarks),
  ];
  return { tagged, lang, title, checks, tree, truncated: reader.truncated };
}

// Inkrementelles Speichern schreibt nur geänderte indirekte Objekte. Steht das Element direkt in einem anderen
// (z. B. in /K eines Elternelements), wird das indirekte Objekt, in dem es steckt, als geändert gemeldet.
function markChanged(doc: PDFDocument, dict: PDFDict): void {
  const holder = [...doc.context.enumerateIndirectObjects()].find(([, object]) => object === dict || (object instanceof PDFDict && contains(object, dict, 0)));
  const ref = holder?.[0];
  const target = holder?.[1];
  if (ref && target) doc.context.assign(ref, target);
}

function contains(object: PDFObject, dict: PDFDict, depth: number): boolean {
  if (depth > 64) return false;
  if (object === dict) return true;
  if (object instanceof PDFDict) return [...object.entries()].some(([, value]) => !(value instanceof PDFRef) && contains(value, dict, depth + 1));
  if (object instanceof PDFArray) return object.asArray().some((value) => !(value instanceof PDFRef) && contains(value, dict, depth + 1));
  return false;
}

// Sprache, Titel, Titelanzeige und Tab-Reihenfolge setzen (inkrementell)
export async function fixAccessibility(bytes: Uint8Array, fix: AccessibilityFix): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new Error('verschlüsselt');
  if (fix.elements) {
    // Gleiche Reihenfolge wie beim Auslesen: die Nummern passen zum angezeigten Baum
    const root = doc.catalog.lookup(N('StructTreeRoot'));
    const reader = new TreeReader(doc);
    if (root instanceof PDFDict) reader.read(root.get(N('K')), 0, new Set());
    for (const edit of fix.elements) {
      const dict = reader.dicts[edit.id];
      if (!dict) throw new Error(`Element ${edit.id} fehlt`);
      for (const [key, value] of [['Alt', edit.alt], ['ActualText', edit.actualText]] as const) {
        if (value === undefined) continue;
        if (value.trim() === '') dict.delete(N(key));
        else dict.set(N(key), PDFHexString.fromText(value.trim()));
      }
      markChanged(doc, dict);
    }
    return doc.commit({ useObjectStreams: false });
  }
  if (fix.lang) doc.catalog.set(N('Lang'), PDFHexString.fromText(fix.lang));
  if (fix.title) {
    let info = doc.context.lookup(doc.context.trailerInfo.Info);
    if (!(info instanceof PDFDict)) {
      info = doc.context.obj({});
      doc.context.trailerInfo.Info = doc.context.register(info as PDFDict);
    }
    (info as PDFDict).set(N('Title'), PDFHexString.fromText(fix.title));
  }
  if (fix.title || infoTitle(doc)) {
    let preferences = doc.catalog.lookup(N('ViewerPreferences'));
    if (!(preferences instanceof PDFDict)) {
      preferences = doc.context.obj({});
      doc.catalog.set(N('ViewerPreferences'), preferences);
    }
    (preferences as PDFDict).set(N('DisplayDocTitle'), PDFBool.True);
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(N('Annots'));
    if (annots instanceof PDFArray && annots.size() > 0) page.node.set(N('Tabs'), N('S'));
  }
  return doc.commit({ useObjectStreams: false });
}
