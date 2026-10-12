// Nachrichten zwischen Renderer und PDFium-Worker.
import type { AnnotationChanges } from '../../shared/annotations';

export interface SaveRequest {
  id: number;
  type: 'save';
  bytes: ArrayBuffer;
  password: string | null;
  changes: AnnotationChanges;
  incremental: boolean;
}

export type WorkerRequest = SaveRequest;

export type WorkerResponse =
  | { id: number; ok: true; bytes: ArrayBuffer }
  | { id: number; ok: false; error: string };
