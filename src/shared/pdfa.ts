// PDF/A (Phase 7, ADR 0017): Ergebnis der Prüfung. Gemeinsam für Oberfläche und Worker.

export type PdfAIssueCode =
  | 'not-declared'
  | 'encrypted'
  | 'output-intent'
  | 'fonts'
  | 'javascript'
  | 'actions'
  | 'embedded-files'
  | 'annotations'
  | 'xfa'
  | 'need-appearances'
  | 'lzw'
  | 'interpolate'
  | 'transfer'
  | 'cmyk'
  | 'id';

export interface PdfAIssue {
  code: PdfAIssueCode;
  // z. B. Schriftnamen
  detail?: string;
  count?: number;
}

export interface PdfAReport {
  // Angabe in den XMP-Metadaten (z. B. Teil 2, Stufe B); null = nicht als PDF/A gekennzeichnet
  declared: { part: number; conformance: string } | null;
  issues: PdfAIssue[];
}
