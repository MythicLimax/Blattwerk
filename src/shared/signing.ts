// Digitale Signaturen mit Zertifikat (Phase 7, ADR 0016). Gemeinsam für Oberfläche und Worker.
import type { Rect } from './annotations';

// Ergebnis der Prüfung einer Signatur
export interface SignatureCheck {
  field: string;
  pageIndex: number | null;
  signer: string | null;
  organization: string | null;
  issuer: string | null;
  // ISO-Zeit (Angabe des Unterzeichners, kein Zeitstempel einer vertrauenswürdigen Stelle)
  signedAt: string | null;
  reason: string | null;
  location: string | null;
  subFilter: string | null;
  // valid: Signatur passt zu den unterschriebenen Bytes; invalid: passt nicht (verändert oder beschädigt);
  // malformed: Signaturangaben fehlerhaft; unsupported: altes, nicht unterstütztes Verfahren
  status: 'valid' | 'invalid' | 'malformed' | 'unsupported';
  // false: Nach dem Unterschreiben wurde das Dokument noch geändert (spätere Speicherstände)
  coversDocument: boolean;
  certificateValidAtSigning: boolean | null;
  selfSigned: boolean | null;
}

// Neue Signatur: Zertifikat (PKCS#12) mit Kennwort, sichtbares Feld (Seite, Rechteck in PDF-Koordinaten) oder unsichtbar
export interface SignRequestInput {
  p12: ArrayBuffer;
  password: string;
  reason: string | null;
  location: string | null;
  // Sichtbares Feld; null = unsichtbare Signatur
  placement: { pageIndex: number; rect: Rect } | null;
  // Texte für das sichtbare Feld (übersetzt von der Oberfläche)
  labels: { signedBy: string; date: string; reason: string };
}

export type SignErrorCode = 'sign-password' | 'sign-certificate' | 'sign-encrypted';

// Gesamturteil für die Leiste über dem Dokument
export type SignaturesSummary = 'none' | 'valid' | 'changed' | 'invalid';

export function summarize(checks: SignatureCheck[]): SignaturesSummary {
  if (checks.length === 0) return 'none';
  if (checks.some((check) => check.status !== 'valid')) return 'invalid';
  // Spätere Signaturen decken frühere Stände ab; entscheidend ist, ob nach der letzten noch etwas geändert wurde
  return checks.some((check) => check.coversDocument) ? 'valid' : 'changed';
}
