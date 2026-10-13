// Formularfelder anlegen, ändern und löschen (Phase 4, „Formular bearbeiten“) mit @cantoo/pdf-lib (MIT).
// PDFium kann Felder anlegen, aber keine Felder vollständig entfernen und keine eindeutigen Werte für
// Optionsfelder vergeben; pdf-lib kann beides und schreibt die Änderung als inkrementelle Aktualisierung
// (das Original bleibt Byte für Byte erhalten). Siehe docs/entscheidungen/0007-formulare.md.
import {
  degrees,
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFHexString,
  PDFName,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFForm,
  type PDFWidgetAnnotation,
} from '@cantoo/pdf-lib';
import type { Rect } from '../../shared/annotations';
import { fieldNameProblem, normalizeFieldSettings, type FieldKind, type FieldOperation, type FieldSettings } from '../../shared/forms';

export type FieldErrorCode = 'field-encrypted' | 'field-missing' | 'field-name';

export class FieldOperationError extends Error {
  constructor(
    readonly code: FieldErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FieldOperationError';
  }
}

// Feldflags (PDF 32000, Tabellen 221, 226, 228, 230)
const FLAG = { readOnly: 1, required: 2, multiline: 1 << 12 } as const;

// Aussehen neuer Felder: dünner grauer Rahmen, durchsichtiger Hintergrund, schwarze Schrift
const BORDER = rgb(0.45, 0.45, 0.45);
const TEXT = rgb(0, 0, 0);
const DA_FONT = 'Helv';

function parseRef(id: string): PDFRef {
  const match = /^(\d+)R(\d*)$/.exec(id);
  if (!match) throw new FieldOperationError('field-missing', `Ungültige Feldreferenz: ${id}`);
  return PDFRef.of(Number(match[1]), match[2] ? Number(match[2]) : 0);
}

interface Located {
  field: PDFField;
  widget: PDFWidgetAnnotation;
  // Position des Widgets unter den Widgets seines Feldes
  index: number;
  widgetRef: PDFRef;
}

class FieldEditor {
  readonly #doc: PDFDocument;
  readonly #form: PDFForm;
  #font: PDFFont | null = null;
  // Felder, deren Darstellung am Ende neu erzeugt wird
  readonly #touched = new Set<PDFField>();

  constructor(doc: PDFDocument) {
    this.#doc = doc;
    this.#form = doc.getForm();
  }

  async apply(operation: FieldOperation): Promise<void> {
    switch (operation.type) {
      case 'createField':
        await this.#create(operation.pageIndex, operation.rect, operation.kind, normalizeFieldSettings(operation.kind, operation.settings));
        return;
      case 'updateField':
        await this.#update(operation.ref, operation.rect, operation.settings);
        return;
      case 'deleteField':
        this.#delete(operation.ref);
        return;
    }
  }

  // Erzeugt die Darstellung der geänderten Felder neu. Schlägt das für ein Feld fehl (z. B. Zeichen, die die
  // Standardschrift nicht kennt), erzeugen die Anzeigeprogramme sie selbst (NeedAppearances).
  async finish(): Promise<void> {
    if (this.#touched.size === 0) return;
    const font = await this.#defaultFont();
    let needAppearances = false;
    for (const field of this.#touched) {
      try {
        if (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList) field.updateAppearances(font);
        else if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) field.updateAppearances();
      } catch {
        needAppearances = true;
      }
    }
    if (needAppearances) this.#form.acroForm.dict.set(PDFName.of('NeedAppearances'), this.#doc.context.obj(true));
  }

  async #defaultFont(): Promise<PDFFont> {
    this.#font ??= await this.#doc.embedFont(StandardFonts.Helvetica);
    return this.#font;
  }

  // Schriftverweis /Helv im Formular-Ressourcenverzeichnis, damit /DA überall auflösbar ist
  #ensureDefaultResources(): void {
    const acroForm = this.#form.acroForm.dict;
    const context = this.#doc.context;
    let resources = acroForm.lookup(PDFName.of('DR'));
    if (!(resources instanceof PDFDict)) {
      resources = context.obj({});
      acroForm.set(PDFName.of('DR'), resources as PDFDict);
    }
    const dr = resources as PDFDict;
    let fonts = dr.lookup(PDFName.of('Font'));
    if (!(fonts instanceof PDFDict)) {
      fonts = context.obj({});
      dr.set(PDFName.of('Font'), fonts as PDFDict);
    }
    const fontDict = fonts as PDFDict;
    if (!fontDict.has(PDFName.of(DA_FONT))) {
      const helvetica = context.register(
        context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }),
      );
      fontDict.set(PDFName.of(DA_FONT), helvetica);
    }
  }

  #setFontSize(field: PDFField, size: number): void {
    this.#ensureDefaultResources();
    const da = `/${DA_FONT} ${size} Tf 0 g`;
    field.acroField.setDefaultAppearance(da);
    for (const widget of field.acroField.getWidgets()) {
      if (widget.dict.has(PDFName.of('DA'))) widget.setDefaultAppearance(da);
    }
  }

  #names(except?: PDFField): string[] {
    return this.#form
      .getFields()
      .filter((field) => field !== except)
      .map((field) => field.getName());
  }

  #checkName(name: string, except?: PDFField, joinsGroup = false): void {
    const problem = fieldNameProblem(name, this.#names(except), joinsGroup);
    if (problem) throw new FieldOperationError('field-name', `Feldname ungültig (${problem}): ${name}`);
  }

  #locate(id: string): Located {
    const ref = parseRef(id);
    for (const field of this.#form.getFields()) {
      const widgets = field.acroField.getWidgets();
      for (let index = 0; index < widgets.length; index++) {
        const widget = widgets[index];
        if (!widget) continue;
        const widgetRef = this.#doc.context.getObjectRef(widget.dict);
        if (widgetRef && widgetRef.objectNumber === ref.objectNumber && widgetRef.generationNumber === ref.generationNumber) {
          return { field, widget, index, widgetRef };
        }
      }
    }
    throw new FieldOperationError('field-missing', `Feld ${id} nicht gefunden`);
  }

  #pageOf(widgetRef: PDFRef): PDFPage | null {
    for (const page of this.#doc.getPages()) {
      const annots = page.node.Annots();
      const index = annots?.indexOf(widgetRef);
      if (index !== undefined && index >= 0) return page;
    }
    return null;
  }

  async #create(pageIndex: number, rect: Rect, kind: FieldKind, settings: FieldSettings): Promise<void> {
    if (pageIndex < 0 || pageIndex >= this.#doc.getPageCount()) throw new FieldOperationError('field-missing', `Seite ${pageIndex + 1} fehlt`);
    const page = this.#doc.getPage(pageIndex);
    const font = await this.#defaultFont();
    const box = {
      x: rect[0],
      y: rect[1],
      width: rect[2] - rect[0],
      height: rect[3] - rect[1],
      textColor: TEXT,
      backgroundColor: undefined,
      borderColor: BORDER,
      borderWidth: 1,
      // Auf gedrehten Seiten steht der Inhalt des Feldes aufrecht zur Ansicht
      rotate: degrees(page.getRotation().angle),
      font,
    };
    const { field, joined } = this.#createField(page, box, kind, settings);
    // pdf-lib vergrößert das Rechteck um die Rahmenbreite; das Feld soll genau die gewünschte Lage haben.
    field.acroField
      .getWidgets()
      .at(-1)
      ?.setRectangle({ x: box.x, y: box.y, width: box.width, height: box.height });
    if (joined) {
      // Beim Beitritt zu einer Gruppe gelten deren Eigenschaften; die QuickInfo braucht auch das neue Widget.
      const tooltip = field.acroField.dict.lookup(PDFName.of('TU'));
      if (tooltip) field.acroField.getWidgets().at(-1)?.dict.set(PDFName.of('TU'), tooltip);
    } else {
      this.#applySettings(field, settings, kind);
    }
    this.#touched.add(field);
  }

  #createField(page: PDFPage, box: Parameters<PDFTextField['addToPage']>[1], kind: FieldKind, settings: FieldSettings): { field: PDFField; joined: boolean } {
    switch (kind) {
      case 'text': {
        this.#checkName(settings.name);
        const text = this.#form.createTextField(settings.name);
        if (settings.multiline) text.enableMultiline();
        text.addToPage(page, box);
        return { field: text, joined: false };
      }
      case 'checkbox': {
        this.#checkName(settings.name);
        const checkBox = this.#form.createCheckBox(settings.name);
        checkBox.addToPage(page, box);
        return { field: checkBox, joined: false };
      }
      case 'radio': {
        // Vorhandene Gruppe gleichen Namens: Der neue Knopf tritt ihr bei.
        const existing = this.#form.getFieldMaybe(settings.name);
        const joined = existing instanceof PDFRadioGroup;
        this.#checkName(settings.name, undefined, joined);
        const group = joined ? existing : this.#form.createRadioGroup(settings.name);
        const value = settings.exportValue || String(group.getOptions().length + 1);
        if (group.getOptions().includes(value)) throw new FieldOperationError('field-name', `Wert schon vergeben: ${value}`);
        group.addOptionToPage(value, page, box);
        return { field: group, joined };
      }
      case 'dropdown': {
        this.#checkName(settings.name);
        const dropdown = this.#form.createDropdown(settings.name);
        dropdown.setOptions(settings.options);
        if (settings.editable) dropdown.enableEditing();
        dropdown.addToPage(page, box);
        return { field: dropdown, joined: false };
      }
      case 'list': {
        this.#checkName(settings.name);
        const list = this.#form.createOptionList(settings.name);
        list.setOptions(settings.options);
        list.addToPage(page, box);
        return { field: list, joined: false };
      }
    }
  }

  // Übernimmt Name, QuickInfo, Flags, Schriftgröße und Auswahleinträge
  #applySettings(field: PDFField, settings: FieldSettings, kind: FieldKind): void {
    // QuickInfo gehört zum Feld; pdf.js liest sie nur am Widget, deshalb steht sie an beiden.
    const holders = new Set([field.acroField.dict, ...field.acroField.getWidgets().map((widget) => widget.dict)]);
    for (const dict of holders) {
      if (settings.tooltip) dict.set(PDFName.of('TU'), PDFHexString.fromText(settings.tooltip));
      else dict.delete(PDFName.of('TU'));
    }
    let flags = field.acroField.getFlags() & ~(FLAG.readOnly | FLAG.required);
    if (settings.readOnly) flags |= FLAG.readOnly;
    if (settings.required) flags |= FLAG.required;
    field.acroField.setFlags(flags);
    if (field instanceof PDFTextField) {
      if (settings.multiline) field.enableMultiline();
      else field.disableMultiline();
    }
    if (field instanceof PDFDropdown) {
      if (settings.editable) field.enableEditing();
      else field.disableEditing();
    }
    if ((field instanceof PDFDropdown || field instanceof PDFOptionList) && kind !== 'text') {
      const before = field.getOptions();
      if (before.length !== settings.options.length || before.some((option, i) => option !== settings.options[i])) {
        const selected = field.getSelected().filter((value) => settings.options.includes(value));
        field.setOptions(settings.options);
        if (selected.length > 0) field.select(selected);
        else field.clear();
      }
    }
    if (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList) {
      this.#setFontSize(field, settings.fontSize);
    }
  }

  async #update(id: string, rect: Rect | undefined, settings: FieldSettings | undefined): Promise<void> {
    const located = this.#locate(id);
    const { field, widget, index } = located;
    if (rect) {
      const before = widget.getRectangle();
      const width = rect[2] - rect[0];
      const height = rect[3] - rect[1];
      widget.setRectangle({ x: rect[0], y: rect[1], width, height });
      // Nur Verschieben: Die Darstellung passt weiter (sie hängt nicht von der Lage ab).
      if (Math.abs(before.width - width) > 0.01 || Math.abs(before.height - height) > 0.01) this.#touched.add(field);
    }
    if (!settings) return;
    const kind = kindOf(field);
    if (!kind) throw new FieldOperationError('field-missing', `Feld ${id} lässt sich nicht bearbeiten`);
    const next = normalizeFieldSettings(kind, settings);
    if (next.name !== field.getName()) this.#rename(field, next.name);
    if (kind === 'radio' && field instanceof PDFRadioGroup) this.#setRadioValue(field, index, next.exportValue);
    this.#applySettings(field, next, kind);
    this.#touched.add(field);
    await Promise.resolve();
  }

  // Umbenennen ändert nur den letzten Teil des Namens; übergeordnete Teile (mit Punkt) bleiben.
  #rename(field: PDFField, name: string): void {
    const full = field.getName();
    const dot = full.lastIndexOf('.');
    const prefix = dot >= 0 ? full.slice(0, dot + 1) : '';
    const partial = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    this.#checkName(partial, field);
    if (this.#names(field).includes(prefix + partial)) throw new FieldOperationError('field-name', `Feldname schon vergeben: ${name}`);
    field.acroField.setPartialName(partial);
  }

  // Wert eines Optionsfeldes ändern: /Opt-Eintrag und, falls der Zustand den Wert als Namen trägt, die
  // Zustandsnamen der Darstellung und den gespeicherten Wert.
  #setRadioValue(group: PDFRadioGroup, index: number, value: string): void {
    if (!value) return;
    const acro = group.acroField;
    acro.normalizeExportValues();
    const options = acro.getExportValues() ?? [];
    const current = options[index]?.decodeText();
    if (current === value) return;
    if (options.some((option, i) => i !== index && option.decodeText() === value)) {
      throw new FieldOperationError('field-name', `Wert schon vergeben: ${value}`);
    }
    const opt = acro.dict.lookup(PDFName.of('Opt'));
    if (opt instanceof PDFArray) opt.set(index, PDFHexString.fromText(value));
  }

  #delete(id: string): void {
    const { field, index, widgetRef } = this.#locate(id);
    const widgets = field.acroField.getWidgets();
    // Letzter (oder einziger) Knopf: ganzes Feld entfernen
    if (widgets.length <= 1) {
      this.#form.removeField(field);
      this.#touched.delete(field);
      return;
    }
    // Ein Knopf einer Gruppe: Widget von der Seite und aus der Gruppe nehmen, /Opt und Zustandsnamen anpassen
    const page = this.#pageOf(widgetRef);
    page?.node.removeAnnot(widgetRef);
    if (field instanceof PDFRadioGroup || field instanceof PDFCheckBox) {
      renumberAfterRemoval(field, index);
    }
    field.acroField.removeWidget(index);
    this.#doc.context.delete(widgetRef);
    this.#touched.add(field);
  }
}

// Entfernt den /Opt-Eintrag des Knopfes an Position index und benennt die Zustände der folgenden Knöpfe um,
// wenn sie ihre Position als Zustandsnamen tragen („0“, „1“, …; so legt pdf-lib Gruppen an).
function renumberAfterRemoval(field: PDFRadioGroup | PDFCheckBox, index: number): void {
  const acro = field.acroField;
  const opt = acro.dict.lookup(PDFName.of('Opt'));
  if (!(opt instanceof PDFArray)) return;
  const widgets = acro.getWidgets();
  const value = acro.dict.lookup(PDFName.of('V'));
  for (let i = index + 1; i < widgets.length; i++) {
    const widget = widgets[i];
    const onValue = widget?.getOnValue();
    if (!widget || !onValue || onValue.decodeText() !== String(i)) continue;
    const renamed = PDFName.of(String(i - 1));
    renameState(widget, onValue, renamed);
    if (value instanceof PDFName && value === onValue) acro.dict.set(PDFName.of('V'), renamed);
  }
  if (index < opt.size()) opt.remove(index);
  // Der gelöschte Knopf war ausgewählt: Gruppe ohne Auswahl
  const removedOn = widgets[index]?.getOnValue();
  if (removedOn && value instanceof PDFName && value === removedOn) acro.dict.set(PDFName.of('V'), PDFName.of('Off'));
}

function renameState(widget: PDFWidgetAnnotation, from: PDFName, to: PDFName): void {
  const ap = widget.dict.lookup(PDFName.of('AP'));
  if (ap instanceof PDFDict) {
    for (const key of ['N', 'D', 'R']) {
      const states = ap.lookup(PDFName.of(key));
      if (!(states instanceof PDFDict)) continue;
      const stream = states.get(from);
      if (stream === undefined) continue;
      states.delete(from);
      states.set(to, stream);
    }
  }
  if (widget.getAppearanceState() === from) widget.setAppearanceState(to);
}

export function kindOf(field: PDFField): FieldKind | null {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'list';
  return null;
}

// Wendet Feldoperationen an und liefert die neuen Bytes (Original + inkrementelle Aktualisierung).
export async function applyFieldOperations(bytes: Uint8Array, operations: FieldOperation[]): Promise<Uint8Array> {
  if (operations.length === 0) return bytes;
  const doc = await PDFDocument.load(bytes, {
    forIncrementalUpdate: true,
    updateMetadata: false,
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  // Neue Zeichenketten würden unverschlüsselt in ein verschlüsseltes Dokument geschrieben.
  if (doc.isEncrypted) throw new FieldOperationError('field-encrypted', 'Formularfelder in verschlüsselten Dokumenten');
  const editor = new FieldEditor(doc);
  for (const operation of operations) await editor.apply(operation);
  await editor.finish();
  return doc.commit({ useObjectStreams: false });
}
