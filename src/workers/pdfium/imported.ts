// Seiten aus anderen PDFs übernehmen (Zusammenführen, Seiten einfügen): Verweise reparieren, die PDFium beim
// Kopieren nicht anpasst, und übernommene Formularfelder ins Formular eintragen. Mit @cantoo/pdf-lib.
//
// PDFium kopiert Seiten samt Anmerkungen, lässt aber den Schlüssel /Parent unverändert (fpdf_ppo.cpp überspringt
// ihn absichtlich). Er zeigt danach auf ein beliebiges Objekt des Zieldokuments. Betroffen sind
//  - Widgets von Formularfeldern: /Parent zeigt auf das Feld, das gar nicht mitkopiert wurde;
//  - Popups von Kommentaren: /Parent zeigt auf den Kommentar auf derselben Seite.
// Die Reparatur ordnet die Anmerkungen der Ziel- und der Quellseite einander zu (PDFium übernimmt /Annots in
// derselben Reihenfolge), kopiert die Feldkette aus der Quelle und setzt /Parent neu.
// Siehe docs/entscheidungen/0007-formulare.md.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFObjectCopier, PDFRef, PDFString, PDFWidgetAnnotation } from '@cantoo/pdf-lib';
import type { ComposePart, PdfSource } from '../../shared/pages';
import { DA_FONT, ensureHelvetica, renameState } from './fields';

const NAME = {
  Annots: PDFName.of('Annots'),
  Parent: PDFName.of('Parent'),
  Kids: PDFName.of('Kids'),
  P: PDFName.of('P'),
  T: PDFName.of('T'),
  FT: PDFName.of('FT'),
  Opt: PDFName.of('Opt'),
  V: PDFName.of('V'),
  Subtype: PDFName.of('Subtype'),
  Widget: PDFName.of('Widget'),
  DA: PDFName.of('DA'),
  DR: PDFName.of('DR'),
  Font: PDFName.of('Font'),
} as const;

const refKey = (ref: PDFRef) => `${ref.objectNumber} ${ref.generationNumber}`;

function dictAt(doc: PDFDocument, value: unknown): PDFDict | null {
  const resolved = value instanceof PDFRef ? doc.context.lookup(value) : value;
  return resolved instanceof PDFDict ? resolved : null;
}

function refsOf(array: PDFArray | undefined): PDFRef[] {
  return (array?.asArray() ?? []).filter((entry): entry is PDFRef => entry instanceof PDFRef);
}

function partialName(dict: PDFDict): string | null {
  const value = dict.lookup(NAME.T);
  return value instanceof PDFHexString || value instanceof PDFString ? value.decodeText() : null;
}

// Braucht die Seite eine Reparatur? (Anmerkungen mit /Parent oder Widgets, die ins Formular müssen)
function pageNeedsRepair(doc: PDFDocument, pageIndex: number): boolean {
  const annots = doc.getPage(pageIndex).node.Annots();
  for (const entry of annots?.asArray() ?? []) {
    const dict = dictAt(doc, entry);
    if (dict && (dict.has(NAME.Parent) || dict.get(NAME.Subtype) === NAME.Widget)) return true;
  }
  return false;
}

interface LoadedImport {
  src: PDFDocument;
  pages: number[];
  destStart: number;
}

async function loadSource(source: PdfSource): Promise<PDFDocument | null> {
  try {
    return await PDFDocument.load(new Uint8Array(source.data), {
      updateMetadata: false,
      throwOnInvalidObject: false,
      ...(source.password ? { password: source.password } : {}),
    });
  } catch {
    return null;
  }
}

// Kopiert die Feldkette eines Widgets aus der Quelle und hängt die übernommenen Widgets darunter.
class FieldCopier {
  readonly #src: PDFDocument;
  readonly #dest: PDFDocument;
  readonly #copier: PDFObjectCopier;
  // Quellfeld → kopiertes Feld
  readonly #fields = new Map<string, PDFRef>();
  // Kopiertes Kind (Widget oder Feld) → sein Gegenstück in der Quelle
  readonly #origin = new Map<string, PDFRef>();

  constructor(src: PDFDocument, dest: PDFDocument) {
    this.#src = src;
    this.#dest = dest;
    this.#copier = PDFObjectCopier.for(src.context, dest.context);
  }

  attach(destWidget: PDFRef, destDict: PDFDict, srcWidget: PDFRef, srcParent: PDFRef): void {
    const field = this.#copyField(srcParent);
    if (!field) {
      destDict.delete(NAME.Parent);
      return;
    }
    destDict.set(NAME.Parent, field);
    this.#kids(field).push(destWidget);
    this.#origin.set(refKey(destWidget), srcWidget);
  }

  #kids(field: PDFRef): PDFArray {
    const dict = this.#dest.context.lookup(field, PDFDict);
    const kids = dict.lookup(NAME.Kids);
    if (kids instanceof PDFArray) return kids;
    const created = this.#dest.context.obj([]);
    dict.set(NAME.Kids, created);
    return created;
  }

  #copyField(srcRef: PDFRef, depth = 0): PDFRef | null {
    const known = this.#fields.get(refKey(srcRef));
    if (known) return known;
    const srcDict = dictAt(this.#src, srcRef);
    if (!srcDict || depth > 32) return null;
    const copy = this.#dest.context.obj({});
    for (const [key, value] of srcDict.entries()) {
      if (key === NAME.Kids || key === NAME.Parent || key === NAME.P) continue;
      copy.set(key, this.#copier.copy(value));
    }
    copy.set(NAME.Kids, this.#dest.context.obj([]));
    const ref = this.#dest.context.register(copy);
    this.#fields.set(refKey(srcRef), ref);
    this.#origin.set(refKey(ref), srcRef);
    const srcParent = srcDict.get(NAME.Parent);
    if (srcParent instanceof PDFRef) {
      const parent = this.#copyField(srcParent, depth + 1);
      if (parent) {
        copy.set(NAME.Parent, parent);
        this.#kids(parent).push(ref);
      }
    }
    return ref;
  }

  // Kinder in der Reihenfolge der Quelle. Bei Optionsfeldern hängt der Wert eines Knopfes an seiner Position
  // (/Opt); fehlen Knöpfe (nur ein Teil der Seiten übernommen), werden /Opt und Zustandsnamen angepasst.
  finish(): void {
    for (const destRef of this.#fields.values()) {
      const srcRef = this.#originOf(destRef);
      const srcDict = srcRef ? dictAt(this.#src, srcRef) : null;
      const destDict = dictAt(this.#dest, destRef);
      if (!srcDict || !destDict) continue;
      const srcKids = refsOf(srcDict.lookup(NAME.Kids) as PDFArray | undefined).map(refKey);
      const kids = refsOf(destDict.lookup(NAME.Kids) as PDFArray | undefined);
      const position = (kid: PDFRef) => {
        const origin = this.#originOf(kid);
        return origin ? srcKids.indexOf(refKey(origin)) : -1;
      };
      const ordered = [...kids].sort((a, b) => position(a) - position(b));
      destDict.set(NAME.Kids, this.#dest.context.obj(ordered));
      const opt = destDict.lookup(NAME.Opt);
      if (!(opt instanceof PDFArray)) continue;
      const kept = ordered.map(position);
      if (kept.length === opt.size() && kept.every((old, i) => old === i)) continue;
      const options = opt.asArray();
      destDict.set(NAME.Opt, this.#dest.context.obj(kept.map((old) => options[old]).filter((entry) => entry !== undefined)));
      const value = destDict.get(NAME.V);
      ordered.forEach((kid, i) => {
        const old = kept[i] ?? -1;
        if (old === i || old < 0) return;
        const widgetDict = dictAt(this.#dest, kid);
        if (!widgetDict) return;
        const widget = PDFWidgetAnnotation.fromDict(widgetDict);
        const onValue = widget.getOnValue();
        if (!onValue || onValue.decodeText() !== String(old)) return;
        renameState(widget, onValue, PDFName.of(String(i)));
        if (value === onValue) destDict.set(NAME.V, PDFName.of(String(i)));
      });
    }
  }

  #originOf(ref: PDFRef): PDFRef | null {
    return this.#origin.get(refKey(ref)) ?? null;
  }
}

function repairPage(dest: PDFDocument, destIndex: number, src: PDFDocument, srcIndex: number, fields: FieldCopier): void {
  const srcAnnots = src.getPage(srcIndex).node.Annots();
  const destAnnots = dest.getPage(destIndex).node.Annots();
  // Ohne gleiche Anzahl ist die Zuordnung unsicher; dann bleibt die Seite unverändert.
  if (!srcAnnots || !destAnnots || srcAnnots.size() !== destAnnots.size()) return;
  for (let i = 0; i < srcAnnots.size(); i++) {
    const srcRef = srcAnnots.get(i);
    const destRef = destAnnots.get(i);
    const srcDict = dictAt(src, srcRef);
    const destDict = dictAt(dest, destRef);
    if (!srcDict || !destDict || !(destRef instanceof PDFRef) || !(srcRef instanceof PDFRef)) continue;
    const srcParent = srcDict.get(NAME.Parent);
    if (!(srcParent instanceof PDFRef)) {
      destDict.delete(NAME.Parent);
      continue;
    }
    // Popup: Eltern-Kommentar steht auf derselben Seite
    const sibling = srcAnnots.indexOf(srcParent);
    if (sibling !== undefined && sibling >= 0) {
      const target = destAnnots.get(sibling);
      if (target instanceof PDFRef) destDict.set(NAME.Parent, target);
      else destDict.delete(NAME.Parent);
      continue;
    }
    fields.attach(destRef, destDict, srcRef, srcParent);
  }
}

// Trägt Felder, deren Widgets auf den Seiten stehen, ins Formularverzeichnis ein. Gibt es den Namen schon,
// bekommt die Kopie einen freien Namen („name 2“), damit die Werte getrennt bleiben. true, wenn sich etwas änderte.
export function registerFieldRoots(doc: PDFDocument): boolean {
  const roots: PDFRef[] = [];
  const seen = new Set<string>();
  for (const page of doc.getPages()) {
    for (const entry of refsOf(page.node.Annots())) {
      const dict = dictAt(doc, entry);
      if (!dict || dict.get(NAME.Subtype) !== NAME.Widget) continue;
      // Wurzel der Feldkette; Widgets ohne Feldtyp (FT) gehören zu keinem Feld
      let root = entry;
      let current: PDFDict = dict;
      let typed = current.has(NAME.FT);
      for (let depth = 0; depth < 32; depth++) {
        const parent: unknown = current.get(NAME.Parent);
        const parentDict = parent instanceof PDFRef ? dictAt(doc, parent) : null;
        if (!(parent instanceof PDFRef) || !parentDict) break;
        root = parent;
        current = parentDict;
        typed ||= current.has(NAME.FT);
      }
      if (typed && !seen.has(refKey(root))) {
        seen.add(refKey(root));
        roots.push(root);
      }
    }
  }
  if (roots.length === 0) return false;
  const existing = doc.catalog.getAcroForm();
  const listed = new Set(refsOf(existing?.Fields()).map(refKey));
  const missing = roots.filter((root) => !listed.has(refKey(root)));
  if (missing.length === 0) return false;
  const acroForm = existing ?? doc.catalog.getOrCreateAcroForm();
  const fields = acroForm.normalizedEntries().Fields;
  const taken = new Set<string>();
  for (const entry of fields.asArray()) {
    const dict = dictAt(doc, entry);
    const name = dict ? partialName(dict) : null;
    if (name !== null) taken.add(name);
  }
  for (const root of missing) {
    const dict = dictAt(doc, root);
    if (!dict) continue;
    const name = partialName(dict);
    if (name !== null) {
      let unique = name;
      for (let n = 2; taken.has(unique); n++) unique = `${name} ${n}`;
      if (unique !== name) dict.set(NAME.T, PDFHexString.fromText(unique));
      taken.add(unique);
    }
    fields.push(root);
  }
  if (!acroForm.dict.has(NAME.DA)) acroForm.dict.set(NAME.DA, PDFString.of(`/${DA_FONT} 0 Tf 0 g`));
  ensureHelvetica(doc, acroForm.dict);
  return true;
}

// Schriften aus dem Formularverzeichnis der Quelle, auf die /DA der übernommenen Felder verweisen kann
function copyFormResources(dest: PDFDocument, src: PDFDocument): void {
  const srcFonts = src.catalog.getAcroForm()?.dict.lookup(NAME.DR);
  const fonts = srcFonts instanceof PDFDict ? srcFonts.lookup(NAME.Font) : undefined;
  if (!(fonts instanceof PDFDict)) return;
  const acroForm = dest.catalog.getOrCreateAcroForm().dict;
  ensureHelvetica(dest, acroForm);
  const destFonts = (acroForm.lookup(NAME.DR) as PDFDict).lookup(NAME.Font) as PDFDict;
  const copier = PDFObjectCopier.for(src.context, dest.context);
  for (const [name, value] of fonts.entries()) {
    if (!destFonts.has(name)) destFonts.set(name, copier.copy(value));
  }
}

async function repair(bytes: Uint8Array, imports: LoadedImport[]): Promise<Uint8Array> {
  const relevant = imports.filter(({ src, pages }) => pages.some((page) => pageNeedsRepair(src, page)));
  if (relevant.length === 0) return bytes;
  const dest = await PDFDocument.load(bytes, {
    forIncrementalUpdate: true,
    updateMetadata: false,
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  // In verschlüsselte Dokumente kann pdf-lib nicht schreiben (siehe fields.ts).
  if (dest.isEncrypted) return bytes;
  for (const { src, pages, destStart } of relevant) {
    const fields = new FieldCopier(src, dest);
    pages.forEach((srcIndex, i) => {
      if (destStart + i < dest.getPageCount()) repairPage(dest, destStart + i, src, srcIndex, fields);
    });
    fields.finish();
    if (src.catalog.getAcroForm()) copyFormResources(dest, src);
  }
  registerFieldRoots(dest);
  return dest.commit({ useObjectStreams: false });
}

// Übernommene Seiten wie bei PDFium: alle, oder die angegebenen ohne Doppelte in gegebener Reihenfolge
const importedPages = (doc: PDFDocument, pages: number[] | null) =>
  pages ? [...new Set(pages)] : Array.from({ length: doc.getPageCount() }, (_, i) => i);

// Nach dem Zusammensetzen eines neuen Dokuments (Teile nacheinander, Bilder je eine Seite)
export async function repairComposed(bytes: Uint8Array, parts: ComposePart[]): Promise<Uint8Array> {
  const imports: LoadedImport[] = [];
  let start = 0;
  for (const part of parts) {
    if (part.type !== 'pdf') {
      start += 1;
      continue;
    }
    const src = await loadSource(part.source);
    // Ohne lesbare Quelle ist die Seitenzahl unbekannt; dann lieber gar nicht reparieren als falsch zuordnen.
    if (!src) return bytes;
    const pages = importedPages(src, part.source.pages);
    imports.push({ src, pages, destStart: start });
    start += pages.length;
  }
  return repair(bytes, imports);
}

// Nach dem Einfügen von Seiten aus einer Datei an Position at
export async function repairInserted(bytes: Uint8Array, source: PdfSource, at: number): Promise<Uint8Array> {
  const src = await loadSource(source);
  if (!src) return bytes;
  return repair(bytes, [{ src, pages: importedPages(src, source.pages), destStart: at }]);
}
