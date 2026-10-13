// Nachrichten zwischen Renderer und PDFium-Worker.
import type { AnnotationChanges } from '../../shared/annotations';
import type { FieldOperation, FormFieldValue } from '../../shared/forms';
import type { ComposePart, PageOperation } from '../../shared/pages';
import type { RedactionArea, RedactionOptions, TextMatch, TextSearchOptions } from '../../shared/redaction';
import type { StampOperation } from '../../shared/stamping';

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

export type WorkerRequest = ProcessRequest | ComposeRequest | InspectRequest | RedactRequest | FindTextRequest;

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
  | 'verify'
  | 'failed';

export type WorkerResponse =
  | { id: number; ok: true; kind: 'bytes'; bytes: ArrayBuffer }
  | { id: number; ok: true; kind: 'inspect'; result: InspectResult }
  | { id: number; ok: true; kind: 'matches'; matches: TextMatch[]; truncated: boolean }
  | { id: number; ok: false; code: WorkerErrorCode; error: string };
