// Ablauf beim Schwärzen (Phase 5, ADR 0008): geteilte Bilder trennen (pdf-lib), Inhalte entfernen und vollständig
// speichern (PDFium), Reste entfernen und neu schreiben (pdf-lib).
import type { AnnotationChanges } from '../../shared/annotations';
import type { FormFieldValue } from '../../shared/forms';
import { mergeAreas, type RedactionArea, type RedactionOptions } from '../../shared/redaction';
import type { PdfiumEngine } from './engine';
import { finishRedaction, isolateSharedXObjects } from './sanitize';

export async function redactDocument(
  engine: PdfiumEngine,
  bytes: Uint8Array,
  password: string | null,
  changes: AnnotationChanges,
  formValues: FormFieldValue[],
  areas: RedactionArea[],
  options: RedactionOptions,
): Promise<Uint8Array> {
  const merged = mergeAreas(areas);
  const isolated = await isolateSharedXObjects(bytes, merged.map((area) => area.pageIndex));
  const redacted = engine.redact(isolated, password, changes, formValues, merged);
  return finishRedaction(redacted, options, merged.map((area) => area.pageIndex));
}
