// Nachrichten zwischen Renderer und PDFium-Worker.
import type { AnnotationChanges } from '../../shared/annotations';
import type { ComposePart, PageOperation } from '../../shared/pages';

// Kommentaränderungen und (optional) Seitenoperationen anwenden, neue Bytes liefern
export interface ProcessRequest {
  id: number;
  type: 'process';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  operations: PageOperation[];
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

export type WorkerRequest = ProcessRequest | ComposeRequest | InspectRequest;

export type InspectResult = { ok: true; pageCount: number } | { ok: false; reason: 'password' | 'invalid' };

// Fehlerarten, die die Oberfläche übersetzt anzeigt (errors.pages.*); 'failed' für alles Unerwartete
export type WorkerErrorCode = 'password' | 'invalid' | 'range' | 'all-pages' | 'image' | 'import' | 'verify' | 'failed';

export type WorkerResponse =
  | { id: number; ok: true; kind: 'bytes'; bytes: ArrayBuffer }
  | { id: number; ok: true; kind: 'inspect'; result: InspectResult }
  | { id: number; ok: false; code: WorkerErrorCode; error: string };
