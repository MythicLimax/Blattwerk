// Dokument bereinigen (ADR 0008, Nachtrag): Metadaten, Anhänge, Skripte und Aktionen, Lesezeichen entfernen und die
// Datei vollständig neu schreiben, ohne unerreichbare Reste. Mit pdf-lib, nie in verschlüsselten Dokumenten.
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject } from '@cantoo/pdf-lib';
import type { CleanFindings, CleanOptions } from '../../shared/clean';
import { reachable, refKey } from './sanitize';

export class CleanError extends Error {
  readonly code = 'clean-encrypted';
  constructor(message: string) {
    super(message);
    this.name = 'CleanError';
  }
}

const N = {
  Metadata: PDFName.of('Metadata'),
  Names: PDFName.of('Names'),
  EmbeddedFiles: PDFName.of('EmbeddedFiles'),
  JavaScript: PDFName.of('JavaScript'),
  OpenAction: PDFName.of('OpenAction'),
  AA: PDFName.of('AA'),
  A: PDFName.of('A'),
  S: PDFName.of('S'),
  Next: PDFName.of('Next'),
  Outlines: PDFName.of('Outlines'),
  PageMode: PDFName.of('PageMode'),
  UseOutlines: PDFName.of('UseOutlines'),
  Annots: PDFName.of('Annots'),
  Subtype: PDFName.of('Subtype'),
  FileAttachment: PDFName.of('FileAttachment'),
  AcroForm: PDFName.of('AcroForm'),
  Fields: PDFName.of('Fields'),
  Kids: PDFName.of('Kids'),
  AF: PDFName.of('AF'),
};

// Aktionen, die etwas ausführen oder starten (statt nur zu einer Stelle zu springen)
const ACTIVE = new Set(['/JavaScript', '/Launch', '/ImportData', '/SubmitForm', '/ResetForm', '/Rendition', '/Sound', '/Movie']);

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new CleanError('Bereinigen verschlüsselter Dokumente');
  return doc;
}

const dict = (doc: PDFDocument, value: PDFObject | undefined): PDFDict | undefined => {
  const target = value ? doc.context.lookup(value) : undefined;
  return target instanceof PDFDict ? target : undefined;
};

// Auch Folgeaktionen (/Next, einzeln oder als Liste) zählen
const isActive = (doc: PDFDocument, action: PDFObject | undefined, depth = 0): boolean => {
  const target = dict(doc, action);
  if (!target || depth > 16) return false;
  if (ACTIVE.has(target.get(N.S)?.toString() ?? '')) return true;
  const next = target.get(N.Next);
  const list = next ? doc.context.lookup(next) : undefined;
  return list instanceof PDFArray ? list.asArray().some((item) => isActive(doc, item, depth + 1)) : isActive(doc, next, depth + 1);
};

function annotations(doc: PDFDocument): Array<{ page: PDFDict; annots: PDFArray }> {
  return doc.getPages().flatMap((page) => {
    const annots = page.node.lookup(N.Annots);
    return annots instanceof PDFArray ? [{ page: page.node, annots }] : [];
  });
}

// Alle Formularfelder samt Unterfeldern
function fields(doc: PDFDocument): PDFDict[] {
  const form = dict(doc, doc.catalog.get(N.AcroForm));
  const result: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const visit = (value: PDFObject | undefined, depth: number) => {
    const field = dict(doc, value);
    if (!field || seen.has(field) || depth > 64) return;
    seen.add(field);
    result.push(field);
    const kids = field.lookup(N.Kids);
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) visit(kid, depth + 1);
  };
  const list = form?.lookup(N.Fields);
  if (list instanceof PDFArray) for (const field of list.asArray()) visit(field, 0);
  return result;
}

export async function findCleanable(bytes: Uint8Array): Promise<CleanFindings> {
  const doc = await load(bytes);
  const names = dict(doc, doc.catalog.get(N.Names));
  const info = doc.context.trailerInfo.Info;
  const annots = annotations(doc).flatMap(({ annots }) => annots.asArray().map((a) => dict(doc, a)).filter((a): a is PDFDict => a !== undefined));
  return {
    metadata: doc.catalog.has(N.Metadata) || (info !== undefined && (dict(doc, info)?.keys().length ?? 0) > 0),
    attachments: names?.has(N.EmbeddedFiles) === true || doc.catalog.has(N.AF) || annots.some((a) => a.get(N.Subtype)?.toString() === '/FileAttachment'),
    scripts:
      names?.has(N.JavaScript) === true ||
      isActive(doc, doc.catalog.get(N.OpenAction)) ||
      doc.catalog.has(N.AA) ||
      doc.getPages().some((page) => page.node.has(N.AA)) ||
      annots.some((a) => a.has(N.AA) || isActive(doc, a.get(N.A))) ||
      fields(doc).some((field) => field.has(N.AA) || isActive(doc, field.get(N.A))),
    bookmarks: doc.catalog.has(N.Outlines),
  };
}

export async function cleanDocument(bytes: Uint8Array, options: CleanOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const names = dict(doc, doc.catalog.get(N.Names));
  if (options.metadata) {
    doc.catalog.delete(N.Metadata);
    doc.context.trailerInfo.Info = undefined;
  }
  if (options.attachments) {
    names?.delete(N.EmbeddedFiles);
    doc.catalog.delete(N.AF);
    for (const { page, annots } of annotations(doc)) {
      const kept = annots.asArray().filter((a) => dict(doc, a)?.get(N.Subtype)?.toString() !== '/FileAttachment');
      if (kept.length !== annots.size()) page.set(N.Annots, doc.context.obj(kept));
    }
  }
  if (options.scripts) {
    names?.delete(N.JavaScript);
    doc.catalog.delete(N.AA);
    if (isActive(doc, doc.catalog.get(N.OpenAction))) doc.catalog.delete(N.OpenAction);
    for (const page of doc.getPages()) page.node.delete(N.AA);
    const holders = [...annotations(doc).flatMap(({ annots }) => annots.asArray().map((a) => dict(doc, a))), ...fields(doc)];
    for (const holder of holders) {
      if (!holder) continue;
      holder.delete(N.AA);
      // Sprünge bleiben (Links zu Seiten, Webadressen), ausführende Aktionen nicht
      if (isActive(doc, holder.get(N.A))) holder.delete(N.A);
    }
  }
  if (options.bookmarks) {
    doc.catalog.delete(N.Outlines);
    if (doc.catalog.get(N.PageMode)?.toString() === '/UseOutlines') doc.catalog.delete(N.PageMode);
  }
  const keep = reachable(doc);
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(refKey(ref))) doc.context.delete(ref);
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
