// Verbindung zum PDFium-Worker. Ein Worker für die ganze App; er startet beim ersten Auftrag und wird kurz
// nach dem letzten beendet. Der WASM-Speicher von PDFium wächst mit großen Dateien und schrumpft nie;
// erst das Beenden gibt ihn frei.
import type { AnnotationChanges } from '../../shared/annotations';
import type { DocumentSecurity, SecuritySettings } from '../../shared/security';
import type { CompressionLevel } from '../../shared/compress';
import type { CompareLabels } from '../../shared/compare';
import type { FieldOperation, FormFieldValue } from '../../shared/forms';
import type { ComposePart, PageOperation } from '../../shared/pages';
import type { RedactionArea, RedactionOptions, TextMatch, TextSearchOptions } from '../../shared/redaction';
import type { StampOperation } from '../../shared/stamping';
import type { ContentOperation, PageObjects } from '../../shared/content';
import type { ImageFormat, InspectResult, WorkerErrorCode, WorkerRequest, WorkerResponse } from '../../workers/pdfium/protocol';

// Fehler aus dem Worker mit Art (für eine übersetzte Meldung) und technischem Text (für Details)
export class PdfiumClientError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PdfiumClientError';
  }
}

type Success = Extract<WorkerResponse, { ok: true }>;
type Pending = { resolve: (response: Success) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 2000;
// Offene Sitzungen (Export, Texterkennung, Vergleich): Solange eine offen ist, bleibt der Worker bestehen.
let openSessions = 0;

function scheduleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size > 0 || openSessions > 0) return;
    worker?.terminate();
    worker = null;
  }, IDLE_MS);
}

// Übergibt den Puffer ohne Kopie, wenn das Array ihn allein belegt.
export function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/pdfium/worker.ts', import.meta.url), { type: 'module', name: 'pdfium' });
  worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (pending.size === 0) scheduleShutdown();
    if (response.ok) entry.resolve(response);
    else entry.reject(new PdfiumClientError(response.code, response.error));
  });
  worker.addEventListener('error', (event) => {
    for (const entry of pending.values()) entry.reject(new PdfiumClientError('failed', event.message || 'pdfium-worker-error'));
    pending.clear();
    // Sitzungen des abgestürzten Workers gibt es nicht mehr; ihre nächsten Aufträge schlagen fehl.
    openSessions = 0;
    worker?.terminate();
    worker = null;
  });
  return worker;
}

type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

function send(body: RequestBody, transfer: Transferable[]): Promise<Success> {
  const id = nextId++;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Derselbe Puffer darf nur einmal in der Transferliste stehen.
    getWorker().postMessage({ ...body, id } as WorkerRequest, [...new Set(transfer)]);
  });
}

async function bytesOf(promise: Promise<Success>): Promise<Uint8Array> {
  const response = await promise;
  if (response.kind !== 'bytes') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return new Uint8Array(response.bytes);
}

export interface ProcessInput {
  changes?: AnnotationChanges;
  operations?: PageOperation[];
  formValues?: FormFieldValue[];
  fieldOperations?: FieldOperation[];
  stampOperations?: StampOperation[];
  contentOperations?: ContentOperation[];
  // Standard: inkrementell (das Original bleibt am Anfang der Datei unverändert)
  incremental?: boolean;
}

// Wendet Kommentaränderungen, Formularwerte und Seiten- oder Feldoperationen an und liefert die neuen Dateibytes.
// Alle übergebenen Puffer (Dokument, eingefügte PDFs und Bilder) gehen an den Worker und sind danach nicht mehr nutzbar.
export function processDocument(bytes: Uint8Array, password: string | null, input: ProcessInput): Promise<Uint8Array> {
  const operations = input.operations ?? [];
  const buffer = ownBuffer(bytes);
  const transfer: Transferable[] = [buffer];
  for (const op of operations) {
    if (op.type === 'insertPdf') transfer.push(op.source.data);
    if (op.type === 'insertImages') transfer.push(...op.images.map((image) => image.data));
  }
  return bytesOf(
    send(
      {
        type: 'process',
        bytes: buffer,
        password,
        changes: input.changes ?? { upserts: [], deletions: [] },
        operations,
        formValues: input.formValues ?? [],
        fieldOperations: input.fieldOperations ?? [],
        stampOperations: input.stampOperations ?? [],
        contentOperations: input.contentOperations ?? [],
        incremental: input.incremental ?? true,
      },
      transfer,
    ),
  );
}

// Schwärzen: liefert das vollständig neu geschriebene Dokument. Die Bytes gehen an den Worker.
export function redactDocument(
  bytes: Uint8Array,
  password: string | null,
  input: { changes: AnnotationChanges; formValues: FormFieldValue[]; areas: RedactionArea[]; options: RedactionOptions },
): Promise<Uint8Array> {
  const buffer = ownBuffer(bytes);
  return bytesOf(send({ type: 'redact', bytes: buffer, password, ...input }, [buffer]));
}

// Text suchen (Lage der Treffer). Die Bytes bleiben beim Aufrufer nutzbar.
export async function findTextMatches(
  bytes: Uint8Array,
  password: string | null,
  options: TextSearchOptions,
): Promise<{ matches: TextMatch[]; truncated: boolean }> {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const response = await send({ type: 'findText', bytes: buffer, password, options }, [buffer]);
  if (response.kind !== 'matches') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return { matches: response.matches, truncated: response.truncated };
}

// Seitenobjekte zum Bearbeiten (Text, Bilder). Die Bytes gehen an den Worker.
export async function listPageObjects(bytes: Uint8Array, password: string | null, pages: number[]): Promise<PageObjects[]> {
  const buffer = ownBuffer(bytes);
  const response = await send({ type: 'listObjects', bytes: buffer, password, pages }, [buffer]);
  if (response.kind !== 'objects') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return response.pages;
}

// Neues Dokument aus Teilen. Die Daten der Teile gehen an den Worker.
export function composeDocument(parts: ComposePart[]): Promise<Uint8Array> {
  const transfer = parts.map((part) => (part.type === 'pdf' ? part.source.data : part.image.data));
  return bytesOf(send({ type: 'compose', parts }, transfer));
}

// Prüft eine Datei (Seitenzahl, Kennwort nötig?). Die Bytes bleiben beim Aufrufer nutzbar.
export async function inspectDocument(bytes: Uint8Array, password: string | null): Promise<InspectResult> {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const response = await send({ type: 'inspect', bytes: buffer, password }, [buffer]);
  if (response.kind !== 'inspect') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return response.result;
}

// Kennwortschutz und Berechtigungen lesen. Die Bytes bleiben beim Aufrufer nutzbar.
export async function readSecurity(bytes: Uint8Array, password: string | null): Promise<DocumentSecurity> {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  const response = await send({ type: 'security', bytes: buffer, password }, [buffer]);
  if (response.kind !== 'security') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return response.security;
}

// Kennwortschutz setzen, ändern oder entfernen (settings null). Liefert das vollständig neu geschriebene Dokument.
export function protectDocument(
  bytes: Uint8Array,
  password: string | null,
  input: { changes: AnnotationChanges; formValues: FormFieldValue[]; settings: SecuritySettings | null },
): Promise<Uint8Array> {
  const buffer = ownBuffer(bytes);
  return bytesOf(send({ type: 'protect', bytes: buffer, password, ...input }, [buffer]));
}

// Dokument für mehrere Seiten geöffnet halten (Export, Texterkennung, Vergleich). Die Bytes gehen an den Worker.
// Ungespeicherte Kommentare und Formularwerte werden übernommen. Immer mit closeSession beenden.
export async function openSession(
  bytes: Uint8Array,
  password: string | null,
  input: { changes?: AnnotationChanges; formValues?: FormFieldValue[] } = {},
): Promise<{ session: number; pageCount: number }> {
  const buffer = ownBuffer(bytes);
  const response = await send(
    { type: 'openSession', bytes: buffer, password, changes: input.changes ?? { upserts: [], deletions: [] }, formValues: input.formValues ?? [] },
    [buffer],
  );
  if (response.kind !== 'session') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  openSessions++;
  return { session: response.session, pageCount: response.pageCount };
}

export interface PageImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  dpi: number;
}

// Seite als PNG/JPEG oder als rohe RGBA-Bildpunkte
export async function renderPage(session: number, pageIndex: number, dpi: number, format: ImageFormat | 'rgba', quality = 0.9): Promise<PageImage> {
  const response = await send({ type: 'renderPage', session, pageIndex, dpi, format, quality }, []);
  if (response.kind !== 'image') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return { bytes: new Uint8Array(response.bytes), width: response.width, height: response.height, dpi: response.dpi };
}

export async function pageText(session: number, pageIndex: number): Promise<string> {
  const response = await send({ type: 'pageText', session, pageIndex }, []);
  if (response.kind !== 'text') throw new PdfiumClientError('failed', 'unerwartete Antwort');
  return response.text;
}

export async function closeSession(session: number): Promise<void> {
  openSessions = Math.max(0, openSessions - 1);
  if (!worker) return;
  await send({ type: 'closeSession', session }, []).catch(() => undefined);
}

// Verkleinern: liefert das vollständig neu geschriebene Dokument. Die Bytes gehen an den Worker.
export function compressDocument(
  bytes: Uint8Array,
  password: string | null,
  input: { changes: AnnotationChanges; formValues: FormFieldValue[]; level: CompressionLevel },
): Promise<Uint8Array> {
  const buffer = ownBuffer(bytes);
  return bytesOf(send({ type: 'compress', bytes: buffer, password, ...input }, [buffer]));
}

// Zwei Dokumente vergleichen: liefert den Vergleichsbericht als neues PDF. Die Bytes gehen an den Worker.
export function compareDocuments(
  oldDoc: { bytes: Uint8Array; password: string | null },
  newDoc: { bytes: Uint8Array; password: string | null },
  names: { old: string; new: string },
  labels: CompareLabels,
): Promise<Uint8Array> {
  const oldBytes = ownBuffer(oldDoc.bytes);
  const newBytes = oldDoc.bytes === newDoc.bytes ? newDoc.bytes.slice().buffer as ArrayBuffer : ownBuffer(newDoc.bytes);
  return bytesOf(
    send({ type: 'compare', oldBytes, oldPassword: oldDoc.password, newBytes, newPassword: newDoc.password, names, labels }, [oldBytes, newBytes]),
  );
}
