// Formularfelder mit PDFium (Phase 4): ausgefüllte Werte übernehmen.
// Werte werden wie bei einer Eingabe gesetzt (Fokus, Text ersetzen, Eintrag wählen, umschalten); danach
// erzeugt PDFium die Darstellung des Feldes neu. Die Formular-Umgebung läuft ohne JavaScript-Anbindung.
import type { FormFieldValue } from '../../shared/forms';
import type { Pdfium } from './memory';
import { withWString } from './memory';

// Eingabetaste schaltet Kontrollkästchen und Optionsfelder um (FORM_OnChar)
const KEY_RETURN = 13;

export class FormValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormValueError';
  }
}

function objectNumber(ref: string): number {
  const match = /^(\d+)R$/.exec(ref);
  if (!match) throw new FormValueError(`Ungültige Feldreferenz: ${ref}`);
  return Number(match[1]);
}

// Führt fn mit einer frischen Formular-Umgebung für eine Seite aus und räumt danach auf.
export function withPageForm<T>(m: Pdfium, doc: number, page: number, fn: (form: number) => T): T {
  const info = m.PDFiumExt_OpenFormFillInfo();
  const form = m.PDFiumExt_InitFormFillEnvironment(doc, info);
  m.FORM_OnAfterLoadPage(page, form);
  try {
    return fn(form);
  } finally {
    m.FORM_OnBeforeClosePage(page, form);
    m.PDFiumExt_ExitFormFillEnvironment(form);
    m.PDFiumExt_CloseFormFillInfo(info);
  }
}

function applyValue(m: Pdfium, form: number, page: number, annot: number, value: FormFieldValue): void {
  if (!m.FORM_SetFocusedAnnot(form, annot)) throw new FormValueError(`Feld ${value.ref} lässt sich nicht auswählen`);
  try {
    switch (value.kind) {
      case 'text':
        if (!m.FORM_SelectAllText(form, page)) throw new FormValueError(`Text in ${value.ref} lässt sich nicht ersetzen`);
        withWString(m, value.text, (ptr) => m.FORM_ReplaceSelection(form, page, ptr));
        break;
      case 'choice':
        if (!m.FORM_SetIndexSelected(form, page, value.index, true)) {
          throw new FormValueError(`Eintrag ${value.index} in ${value.ref} lässt sich nicht wählen`);
        }
        break;
      case 'checked':
        if (Boolean(m.FPDFAnnot_IsChecked(form, annot)) !== value.checked) m.FORM_OnChar(form, page, KEY_RETURN, 0);
        break;
    }
  } finally {
    m.FORM_ForceToKillFocus(form);
  }
  m.EPDFAnnot_GenerateFormFieldAP(annot);
}

// Übernimmt alle geänderten Feldwerte, seitenweise.
export function applyFormValues(m: Pdfium, doc: number, values: FormFieldValue[]): void {
  const byPage = new Map<number, FormFieldValue[]>();
  for (const value of values) byPage.set(value.pageIndex, [...(byPage.get(value.pageIndex) ?? []), value]);
  for (const [pageIndex, list] of byPage) {
    const page = m.FPDF_LoadPage(doc, pageIndex);
    if (!page) throw new FormValueError(`Seite ${pageIndex + 1} lässt sich nicht laden`);
    try {
      withPageForm(m, doc, page, (form) => {
        for (const value of list) {
          const annot = m.EPDFPage_GetAnnotByObjectNumber(page, objectNumber(value.ref));
          if (!annot) throw new FormValueError(`Feld ${value.ref} nicht gefunden`);
          try {
            applyValue(m, form, page, annot, value);
          } finally {
            m.FPDFPage_CloseAnnot(annot);
          }
        }
      });
    } finally {
      m.FPDF_ClosePage(page);
    }
  }
}
