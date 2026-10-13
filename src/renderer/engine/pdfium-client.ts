// Verbindung zum PDFium-Worker. Ein Worker für die ganze App; er startet beim ersten Auftrag und wird kurz
// nach dem letzten beendet. Der WASM-Speicher von PDFium wächst mit großen Dateien und schrumpft nie;
// erst das Beenden gibt ihn frei.
import type { AnnotationChanges } from '../../shared/annotations';
import type { ComposePart, PageOperation } from '../../shared/pages';
import type { InspectResult, WorkerErrorCode, WorkerRequest, WorkerResponse } from '../../workers/pdfium/protocol';

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

function scheduleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (pending.size > 0) return;
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

// Wendet Kommentaränderungen und Seitenoperationen an und liefert die neuen Dateibytes (Standard: inkrementell).
// Alle übergebenen Puffer (Dokument, eingefügte PDFs und Bilder) gehen an den Worker und sind danach nicht mehr nutzbar.
export function processDocument(
  bytes: Uint8Array,
  password: string | null,
  changes: AnnotationChanges,
  operations: PageOperation[] = [],
  incremental = true,
): Promise<Uint8Array> {
  const buffer = ownBuffer(bytes);
  const transfer: Transferable[] = [buffer];
  for (const op of operations) {
    if (op.type === 'insertPdf') transfer.push(op.source.data);
    if (op.type === 'insertImages') transfer.push(...op.images.map((image) => image.data));
  }
  return bytesOf(send({ type: 'process', bytes: buffer, password, changes, operations, incremental }, transfer));
}

export function saveAnnotationChanges(
  bytes: Uint8Array,
  password: string | null,
  changes: AnnotationChanges,
  incremental = true,
): Promise<Uint8Array> {
  return processDocument(bytes, password, changes, [], incremental);
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
