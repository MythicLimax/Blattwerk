// Nachrichten zwischen Renderer und PDFium-Worker.
import type { AnnotationChanges } from '../../shared/annotations';
import type { FieldOperation, FormFieldValue } from '../../shared/forms';
import type { ComposePart, PageOperation } from '../../shared/pages';
import type { RedactionArea, RedactionOptions, TextMatch, TextSearchOptions } from '../../shared/redaction';
import type { StampOperation } from '../../shared/stamping';
import type { ContentOperation, PageObjects } from '../../shared/content';
import type { DocumentSecurity, SecuritySettings } from '../../shared/security';
import type { CompressionLevel } from '../../shared/compress';
import type { CleanFindings, CleanOptions } from '../../shared/clean';
import type { CompareLabels } from '../../shared/compare';
import type { SignatureCheck, SignRequestInput } from '../../shared/signing';
import type { PdfAReport } from '../../shared/pdfa';
import type { AccessibilityFix, AccessibilityReport } from '../../shared/accessibility';

// Kommentaränderungen, Formularwerte und (optional) Seiten- oder Feldoperationen anwenden, neue Bytes liefern
export interface ProcessRequest {
  id: number;
  type: 'process';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  operations: PageOperation[];
  formValues: FormFieldValue[];
  // Formularfelder anlegen, ändern, löschen (nach allen übrigen Änderungen, immer inkrementell)
  fieldOperations: FieldOperation[];
  // Wasserzeichen, Kopf- und Fußzeilen (zuletzt, immer inkrementell)
  stampOperations: StampOperation[];
  // Seiteninhalt bearbeiten (PDFium, nach Kommentaren und Formularwerten)
  contentOperations: ContentOperation[];
  incremental: boolean;
}

// Neues Dokument aus Teilen zusammensetzen
export interface ComposeRequest {
  id: number;
  type: 'compose';
  parts: ComposePart[];
}

// Seitenzahl ermitteln bzw. feststellen, ob ein Kennwort nötig ist
export interface InspectRequest {
  id: number;
  type: 'inspect';
  bytes: ArrayBuffer;
  password: string | null;
}

// Schwärzen: Kommentare und Formularwerte übernehmen, Bereiche endgültig entfernen, vollständig neu schreiben
export interface RedactRequest {
  id: number;
  type: 'redact';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  areas: RedactionArea[];
  options: RedactionOptions;
}

// Text suchen und die Lage der Treffer liefern
export interface FindTextRequest {
  id: number;
  type: 'findText';
  bytes: ArrayBuffer;
  password: string | null;
  options: TextSearchOptions;
}

// Seitenobjekte zum Bearbeiten auflisten
export interface ListObjectsRequest {
  id: number;
  type: 'listObjects';
  bytes: ArrayBuffer;
  password: string | null;
  pages: number[];
}

// Kennwortschutz und Berechtigungen lesen
export interface SecurityRequest {
  id: number;
  type: 'security';
  bytes: ArrayBuffer;
  password: string | null;
}

// Kennwortschutz setzen, ändern oder entfernen (settings null): Kommentare und Formularwerte übernehmen, Schutz
// entfernen, auf Wunsch neu verschlüsseln. Immer vollständig neu geschrieben.
export interface ProtectRequest {
  id: number;
  type: 'protect';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  settings: SecuritySettings | null;
}

// Verkleinern: Kommentare und Formularwerte übernehmen, Bilder neu kodieren, vollständig neu schreiben
export interface CompressRequest {
  id: number;
  type: 'compress';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  level: CompressionLevel;
}

// Zwei Dokumente vergleichen und einen Bericht als neues PDF liefern
export interface CompareRequest {
  id: number;
  type: 'compare';
  oldBytes: ArrayBuffer;
  oldPassword: string | null;
  newBytes: ArrayBuffer;
  newPassword: string | null;
  names: { old: string; new: string };
  labels: CompareLabels;
}

// Mit Zertifikat unterschreiben (PAdES): ungespeicherte Kommentare und Formularwerte zuerst, dann inkrementell
export interface SignRequest {
  id: number;
  type: 'sign';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  input: SignRequestInput;
}

// Signaturen eines Dokuments prüfen
export interface VerifySignaturesRequest {
  id: number;
  type: 'verifySignatures';
  bytes: ArrayBuffer;
}

// Eigene digitale ID (.p12) erstellen
export interface CreateIdentityRequest {
  id: number;
  type: 'createIdentity';
  name: string;
  organization: string | null;
  email: string | null;
  password: string;
  years: number;
}

// Als PDF/A-2b speichern: ungespeicherte Änderungen übernehmen, Schutz entfernen, dann umwandeln (pdfa.ts)
export interface PdfARequest {
  id: number;
  type: 'pdfa';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  // CMYK-Profil für DefaultCMYK (aus den Ressourcen von pdf.js)
  cmykProfile: ArrayBuffer | null;
  producer: string;
  // Schriften des Rechners für nicht eingebettete Schriften (Schriftname aus der PDF → TrueType-Daten)
  systemFonts: Array<{ baseFont: string; data: ArrayBuffer }>;
}

// Dokument bereinigen: Kommentare und Formularwerte übernehmen, dann Gewähltes entfernen und vollständig neu schreiben
export interface CleanRequest {
  id: number;
  type: 'clean';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  options: CleanOptions;
}

// Was sich bereinigen lässt (für den Dialog)
export interface FindCleanableRequest {
  id: number;
  type: 'findCleanable';
  bytes: ArrayBuffer;
}

// Auf PDF/A prüfen
export interface CheckPdfARequest {
  id: number;
  type: 'checkPdfA';
  bytes: ArrayBuffer;
}

// Barrierefreiheit prüfen (Tags auslesen); verschlüsselte Dokumente entschlüsselt PDFium vorher
export interface AccessibilityRequest {
  id: number;
  type: 'accessibility';
  bytes: ArrayBuffer;
  password: string | null;
  encrypted: boolean;
}

// Sprache, Titel und Tab-Reihenfolge setzen: ungespeicherte Änderungen zuerst, dann inkrementell
export interface AccessibilityFixRequest {
  id: number;
  type: 'accessibilityFix';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
  fix: AccessibilityFix;
}

// Sitzung: Dokument für mehrere Seiten geöffnet halten (Export, Texterkennung, Vergleich)
export interface OpenSessionRequest {
  id: number;
  type: 'openSession';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  formValues: FormFieldValue[];
}

export type ImageFormat = 'png' | 'jpeg';

// Seite als Bild (PNG/JPEG kodiert) oder als rohe RGBA-Bildpunkte
export interface RenderPageRequest {
  id: number;
  type: 'renderPage';
  session: number;
  pageIndex: number;
  dpi: number;
  format: ImageFormat | 'rgba';
  // JPEG-Qualität 0 bis 1
  quality: number;
}

export interface PageTextRequest {
  id: number;
  type: 'pageText';
  session: number;
  pageIndex: number;
}

export interface CloseSessionRequest {
  id: number;
  type: 'closeSession';
  session: number;
}

export type WorkerRequest =
  | ProcessRequest
  | ComposeRequest
  | InspectRequest
  | RedactRequest
  | FindTextRequest
  | ListObjectsRequest
  | SecurityRequest
  | ProtectRequest
  | OpenSessionRequest
  | RenderPageRequest
  | PageTextRequest
  | CloseSessionRequest
  | CompressRequest
  | CleanRequest
  | FindCleanableRequest
  | CompareRequest
  | SignRequest
  | VerifySignaturesRequest
  | CreateIdentityRequest
  | PdfARequest
  | CheckPdfARequest
  | AccessibilityRequest
  | AccessibilityFixRequest;

export type InspectResult = { ok: true; pageCount: number } | { ok: false; reason: 'password' | 'invalid' };

// Fehlerarten, die die Oberfläche übersetzt anzeigt (errors.pages.*); 'failed' für alles Unerwartete
export type WorkerErrorCode =
  | 'password'
  | 'invalid'
  | 'range'
  | 'all-pages'
  | 'crop-too-small'
  | 'image'
  | 'import'
  | 'form'
  | 'field-encrypted'
  | 'field-missing'
  | 'field-name'
  | 'redact-encrypted'
  | 'stamp-encrypted'
  | 'stamp-characters'
  | 'stamp-font'
  | 'stamp-nothing'
  | 'stamp-image'
  | 'content-missing'
  | 'content-characters'
  | 'compress-encrypted'
  | 'clean-encrypted'
  | 'sign-password'
  | 'sign-certificate'
  | 'sign-encrypted'
  | 'verify'
  | 'pdfa-fonts'
  | 'pdfa-cmyk'
  | 'failed';

export type WorkerResponse =
  | { id: number; ok: true; kind: 'bytes'; bytes: ArrayBuffer }
  | { id: number; ok: true; kind: 'inspect'; result: InspectResult }
  | { id: number; ok: true; kind: 'matches'; matches: TextMatch[]; truncated: boolean }
  | { id: number; ok: true; kind: 'objects'; pages: PageObjects[] }
  | { id: number; ok: true; kind: 'security'; security: DocumentSecurity }
  | { id: number; ok: true; kind: 'session'; session: number; pageCount: number }
  | { id: number; ok: true; kind: 'image'; bytes: ArrayBuffer; width: number; height: number; dpi: number }
  | { id: number; ok: true; kind: 'text'; text: string }
  | { id: number; ok: true; kind: 'done' }
  | { id: number; ok: true; kind: 'signatures'; checks: SignatureCheck[] }
  | { id: number; ok: true; kind: 'pdfa'; report: PdfAReport }
  | { id: number; ok: true; kind: 'cleanable'; findings: CleanFindings }
  | { id: number; ok: true; kind: 'accessibility'; report: AccessibilityReport }
  // Bytes, die kein PDF sind (z. B. eine .p12-Datei)
  | { id: number; ok: true; kind: 'raw'; bytes: ArrayBuffer }
  | { id: number; ok: false; code: WorkerErrorCode; error: string };
