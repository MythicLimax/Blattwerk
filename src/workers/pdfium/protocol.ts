// Nachrichten zwischen Renderer und PDFium-Worker.
import type { AnnotationChanges } from '../../shared/annotations';
import type { FieldOperation, FormFieldValue } from '../../shared/forms';
import type { ComposePart, PageOperation } from '../../shared/pages';
import type { RedactionArea, RedactionOptions, TextMatch, TextSearchOptions } from '../../shared/redaction';
import type { StampOperation } from '../../shared/stamping';
import type { ContentOperation, PageObjects } from '../../shared/content';
import type { DocumentSecurity, SecuritySettings } from '../../shared/security';
import type { CompressionLevel } from '../../shared/compress';
import type { CompareLabels } from '../../shared/compare';

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
  | CompareRequest;

export type InspectResult = { ok: true; pageCount: number } | { ok: false; reason: 'password' | 'invalid' };

// Fehlerarten, die die Oberfläche übersetzt anzeigt (errors.pages.*); 'failed' für alles Unerwartete
export type WorkerErrorCode =
  | 'password'
  | 'invalid'
  | 'range'
  | 'all-pages'
  | 'image'
  | 'import'
  | 'form'
  | 'field-encrypted'
  | 'field-missing'
  | 'field-name'
  | 'redact-encrypted'
  | 'stamp-encrypted'
  | 'stamp-characters'
  | 'stamp-nothing'
  | 'stamp-image'
  | 'content-missing'
  | 'content-characters'
  | 'compress-encrypted'
  | 'verify'
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
  | { id: number; ok: false; code: WorkerErrorCode; error: string };
