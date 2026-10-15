// Längere Aufgaben mit Fortschritt und „Abbrechen“ (Phase 6: Export, Texterkennung, Komprimieren, Vergleich).
// Es läuft immer höchstens eine solche Aufgabe; die Oberfläche zeigt dabei den Fortschrittsdialog.
import { create } from 'zustand';

export interface ProgressState {
  // Übersetzungsschlüssel des Titels
  title: string;
  done: number;
  total: number;
  // Übersetzungsschlüssel und Werte für die Zeile unter dem Balken (z. B. „Seite 3 von 12“)
  step: { key: string; values?: Record<string, string | number> } | null;
  cancelling: boolean;
}

interface ProgressStore {
  progress: ProgressState | null;
}

export const useProgress = create<ProgressStore>(() => ({ progress: null }));

let controller: AbortController | null = null;

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

export function isRunning(): boolean {
  return controller !== null;
}

export function cancelProgress(): void {
  if (!controller) return;
  controller.abort();
  const current = useProgress.getState().progress;
  if (current) useProgress.setState({ progress: { ...current, cancelling: true } });
}

export interface ProgressHandle {
  signal: AbortSignal;
  // Fortschritt melden; wirft Cancelled, wenn abgebrochen wurde
  step: (done: number, step?: ProgressState['step'], total?: number) => void;
}

// Führt task mit Fortschrittsdialog aus. Liefert null, wenn abgebrochen wurde (oder schon eine Aufgabe läuft).
export async function withProgress<T>(title: string, total: number, task: (handle: ProgressHandle) => Promise<T>): Promise<T | null> {
  if (controller) return null;
  const own = new AbortController();
  controller = own;
  useProgress.setState({ progress: { title, done: 0, total, step: null, cancelling: false } });
  const handle: ProgressHandle = {
    signal: own.signal,
    step: (done, step, nextTotal) => {
      if (own.signal.aborted) throw new Cancelled();
      const current = useProgress.getState().progress;
      if (current) useProgress.setState({ progress: { ...current, done, step: step ?? current.step, total: nextTotal ?? current.total } });
    },
  };
  try {
    return await task(handle);
  } catch (error) {
    if (error instanceof Cancelled || own.signal.aborted) return null;
    throw error;
  } finally {
    controller = null;
    useProgress.setState({ progress: null });
  }
}
