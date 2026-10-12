// Verbindung zum PDFium-Worker. Ein Worker für die ganze App; er startet beim ersten Speichern und wird kurz
// nach dem letzten Auftrag beendet. Der WASM-Speicher von PDFium wächst mit großen Dateien und schrumpft nie;
// erst das Beenden gibt ihn frei.
import type { AnnotationChanges } from '../../shared/annotations';
import type { WorkerRequest, WorkerResponse } from '../../workers/pdfium/protocol';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
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
    if (response.ok) entry.resolve(new Uint8Array(response.bytes));
    else entry.reject(new Error(response.error));
  });
  worker.addEventListener('error', (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message || 'pdfium-worker-error'));
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}

// Wendet die Kommentaränderungen an und liefert die neuen Dateibytes (Standard: inkrementell).
// Die übergebenen Bytes werden an den Worker abgegeben und sind danach nicht mehr nutzbar.
export function saveAnnotationChanges(
  bytes: Uint8Array,
  password: string | null,
  changes: AnnotationChanges,
  incremental = true,
): Promise<Uint8Array> {
  const id = nextId++;
  const buffer = ownBuffer(bytes);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const request: WorkerRequest = { id, type: 'save', bytes: buffer, password, changes, incremental };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request, [buffer]);
  });
}
