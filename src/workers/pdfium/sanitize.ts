// Vor- und Nacharbeiten beim Schwärzen mit @cantoo/pdf-lib (Phase 5, ADR 0008).
//
// Vorher: Bilder und Formular-XObjects, die eine geschwärzte Seite mit anderen Seiten teilt, bekommt die Seite als
// eigene Kopie. PDFium überschreibt Bildpunkte im Bildobjekt selbst; ohne Kopie wären sonst auch die anderen
// Seiten geschwärzt.
//
// Nachher: Formularfelder ohne Widget entfernen (ihr Wert stünde sonst weiter in der Datei), auf Wunsch die
// Metadaten löschen, alle nicht mehr erreichbaren Objekte verwerfen und die Datei vollständig neu schreiben. So
// bleibt von entfernten Inhalten nichts zurück, auch keine älteren Stände der Datei.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFObject } from '@cantoo/pdf-lib';

export class SanitizeError extends Error {
  readonly code = 'redact-encrypted';
  constructor(message: string) {
    super(message);
    this.name = 'SanitizeError';
  }
}

const NAME = {
  Resources: PDFName.of('Resources'),
  XObject: PDFName.of('XObject'),
  Subtype: PDFName.of('Subtype'),
  Form: PDFName.of('Form'),
  Image: PDFName.of('Image'),
  AcroForm: PDFName.of('AcroForm'),
  Fields: PDFName.of('Fields'),
  Kids: PDFName.of('Kids'),
  Metadata: PDFName.of('Metadata'),
  Thumb: PDFName.of('Thumb'),
  StructTreeRoot: PDFName.of('StructTreeRoot'),
  K: PDFName.of('K'),
  Pg: PDFName.of('Pg'),
} as const;

// Texte im Strukturbaum (barrierefreie PDFs), die Inhalte beschreiben oder ersetzen
const DESCRIPTIONS = ['Alt', 'ActualText', 'E'].map((key) => PDFName.of(key));

const refKey = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber}`;

async function load(bytes: Uint8Array, forIncrementalUpdate: boolean): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, {
    forIncrementalUpdate,
    updateMetadata: false,
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  // Neue Zeichenketten würden unverschlüsselt geschrieben; Schwärzen verschlüsselter Dokumente erst nach dem
  // Entfernen des Kennwortschutzes.
  if (doc.isEncrypted) throw new SanitizeError('Schwärzen in verschlüsselten Dokumenten');
  return doc;
}

// Alle Werte eines Objekts, die Verweise enthalten können
function children(object: PDFObject): PDFObject[] {
  if (object instanceof PDFDict) return object.entries().map(([, value]) => value);
  if (object instanceof PDFArray) return object.asArray();
  if (object instanceof PDFStream) return object.dict.entries().map(([, value]) => value);
  return [];
}

// Wie oft wird jedes Objekt referenziert?
function referenceCounts(doc: PDFDocument): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (object: PDFObject) => {
    if (object instanceof PDFRef) {
      counts.set(refKey(object), (counts.get(refKey(object)) ?? 0) + 1);
      return;
    }
    for (const child of children(object)) visit(child);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  return counts;
}

function cloneStream(doc: PDFDocument, ref: PDFRef): PDFRef {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return ref;
  return doc.context.register(stream.clone(doc.context));
}

// Eigenes (direktes) Wörterbuch unter key, damit Änderungen nur diesen Besitzer betreffen
function ownDict(doc: PDFDocument, owner: PDFDict, key: PDFName): PDFDict | null {
  const value = owner.get(key);
  const dict = value instanceof PDFRef ? doc.context.lookup(value) : value;
  if (!(dict instanceof PDFDict)) return null;
  const copy = dict.clone(doc.context);
  owner.set(key, copy);
  return copy;
}

function isolateResources(doc: PDFDocument, resources: PDFDict, counts: Map<string, number>, depth: number): void {
  const xobjects = ownDict(doc, resources, NAME.XObject);
  if (!xobjects || depth > 16) return;
  for (const [name, value] of xobjects.entries()) {
    if (!(value instanceof PDFRef)) continue;
    const object = doc.context.lookup(value);
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict.get(NAME.Subtype);
    const shared = (counts.get(refKey(value)) ?? 0) > 1;
    if (subtype === NAME.Image && shared) {
      xobjects.set(name, cloneStream(doc, value));
    } else if (subtype === NAME.Form) {
      // Formulare immer prüfen: Sie können geteilte Bilder enthalten.
      const ref = shared ? cloneStream(doc, value) : value;
      xobjects.set(name, ref);
      const form = doc.context.lookup(ref);
      if (form instanceof PDFRawStream) {
        const formResources = ownDict(doc, form.dict, NAME.Resources);
        if (formResources) isolateResources(doc, formResources, counts, depth + 1);
      }
    }
  }
}

// Gibt den Seiten mit Schwärzungen eigene Kopien geteilter Bilder und Formular-XObjects.
export async function isolateSharedXObjects(bytes: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes, true);
  const counts = referenceCounts(doc);
  for (const index of new Set(pageIndices)) {
    if (index < 0 || index >= doc.getPageCount()) continue;
    const page = doc.getPage(index);
    // Geerbte oder geteilte Ressourcen als eigenes Wörterbuch der Seite
    const inherited = page.node.Resources();
    if (!inherited) continue;
    page.node.set(NAME.Resources, inherited.clone(doc.context));
    const resources = page.node.Resources();
    if (resources) isolateResources(doc, resources, counts, 0);
  }
  return doc.commit({ useObjectStreams: false });
}

// Formularfelder entfernen, deren Widgets auf keiner Seite mehr stehen (beim Schwärzen gelöscht)
function removeOrphanFields(doc: PDFDocument): void {
  const onPages = new Set<string>();
  for (const page of doc.getPages()) {
    for (const entry of page.node.Annots()?.asArray() ?? []) if (entry instanceof PDFRef) onPages.add(refKey(entry));
  }
  const acroForm = doc.catalog.lookup(NAME.AcroForm);
  if (!(acroForm instanceof PDFDict)) return;
  // Liefert true, wenn der Knoten (Feld oder Widget) bleibt
  const keep = (ref: PDFObject, depth: number): boolean => {
    if (!(ref instanceof PDFRef) || depth > 32) return false;
    const node = doc.context.lookup(ref);
    if (!(node instanceof PDFDict)) return false;
    const kids = node.lookup(NAME.Kids);
    if (kids instanceof PDFArray) {
      const kept = kids.asArray().filter((kid) => keep(kid, depth + 1));
      node.set(NAME.Kids, doc.context.obj(kept));
      return kept.length > 0;
    }
    // Endpunkt: Widget (oder Feld mit eingebettetem Widget)
    return onPages.has(refKey(ref));
  };
  const fields = acroForm.lookup(NAME.Fields);
  if (fields instanceof PDFArray) acroForm.set(NAME.Fields, doc.context.obj(fields.asArray().filter((field) => keep(field, 0))));
}

// Alle Objekte, die vom Dateiende (Katalog, Dokumentinformationen) aus erreichbar sind
function reachable(doc: PDFDocument): Set<string> {
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info } = doc.context.trailerInfo;
  if (Root) stack.push(Root);
  if (Info) stack.push(Info);
  while (stack.length > 0) {
    const object = stack.pop() as PDFObject;
    if (object instanceof PDFRef) {
      if (seen.has(refKey(object))) continue;
      seen.add(refKey(object));
      const target = doc.context.lookup(object);
      if (target) stack.push(target);
      continue;
    }
    stack.push(...children(object));
  }
  return seen;
}

// Beschreibungen im Strukturbaum (z. B. /Alt „Unterschrift von …“) für Elemente auf geschwärzten Seiten entfernen.
// Welche Elemente genau geschwärzte Inhalte beschreiben, lässt sich nicht sicher feststellen; deshalb alle der Seite.
function removeStructureDescriptions(doc: PDFDocument, pageIndices: number[]): void {
  const pages = new Set(pageIndices.filter((i) => i >= 0 && i < doc.getPageCount()).map((i) => refKey(doc.getPage(i).ref)));
  const root = doc.catalog.lookup(NAME.StructTreeRoot);
  if (pages.size === 0 || !(root instanceof PDFDict)) return;
  const seen = new Set<string>();
  const visit = (node: PDFObject | undefined, page: string | null, depth: number) => {
    if (node === undefined || depth > 256) return;
    if (node instanceof PDFRef) {
      if (seen.has(refKey(node))) return;
      seen.add(refKey(node));
      visit(doc.context.lookup(node), page, depth + 1);
      return;
    }
    if (node instanceof PDFArray) {
      for (const child of node.asArray()) visit(child, page, depth + 1);
      return;
    }
    if (!(node instanceof PDFDict)) return;
    const own = node.get(NAME.Pg);
    const current = own instanceof PDFRef ? refKey(own) : page;
    if (current !== null && pages.has(current)) for (const key of DESCRIPTIONS) node.delete(key);
    visit(node.get(NAME.K), current, depth + 1);
  };
  visit(root.get(NAME.K), null, 0);
}

export async function finishRedaction(bytes: Uint8Array, options: { removeMetadata: boolean }, pageIndices: number[] = []): Promise<Uint8Array> {
  const doc = await load(bytes, false);
  removeOrphanFields(doc);
  removeStructureDescriptions(doc, pageIndices);
  // Fertige Vorschaubilder der Seiten zeigen den alten Inhalt; Anzeigeprogramme erzeugen sie bei Bedarf selbst.
  for (const page of doc.getPages()) page.node.delete(NAME.Thumb);
  if (options.removeMetadata) {
    doc.catalog.delete(NAME.Metadata);
    doc.context.trailerInfo.Info = undefined;
  }
  const keep = reachable(doc);
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(refKey(ref))) doc.context.delete(ref);
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
