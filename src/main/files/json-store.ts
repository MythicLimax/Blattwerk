import { promises as fs } from 'node:fs';
import { atomicWrite } from './atomic-write';

// Kleiner JSON-Speicher für Einstellungen und die Liste zuletzt geöffneter Dateien.
// Schreibt immer atomar, damit ein Absturz die Datei nicht zerstört.
export class JsonStore<T> {
  #filePath: string;
  #fallback: () => T;
  #validate: (raw: unknown) => T | null;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, fallback: () => T, validate: (raw: unknown) => T | null) {
    this.#filePath = filePath;
    this.#fallback = fallback;
    this.#validate = validate;
  }

  async read(): Promise<T> {
    try {
      const text = await fs.readFile(this.#filePath, 'utf8');
      return this.#validate(JSON.parse(text)) ?? this.#fallback();
    } catch {
      return this.#fallback();
    }
  }

  // Schreibvorgänge laufen nacheinander, damit sich zwei schnelle Änderungen nicht überholen.
  write(value: T): Promise<void> {
    const next = this.#writeChain.then(() => atomicWrite(this.#filePath, JSON.stringify(value, null, 2)));
    this.#writeChain = next.catch(() => undefined);
    return next;
  }
}
