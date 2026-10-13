import { randomUUID } from 'node:crypto';
import type { SavedSignature, SignatureInput } from '../../shared/ipc';
import { MAX_SIGNATURES } from '../../shared/ipc';
import { isSignatureInput } from '../../shared/validate';
import { JsonStore } from './json-store';

// Gespeicherte Unterschriften (Phase 4), lokal im Profilordner. Nur PNG-Bilder, höchstens MAX_SIGNATURES Stück.
export class SignatureStore {
  #store: JsonStore<SavedSignature[]>;

  constructor(filePath: string) {
    this.#store = new JsonStore<SavedSignature[]>(filePath, () => [], (raw) => {
      if (!Array.isArray(raw)) return null;
      return raw.filter(
        (entry): entry is SavedSignature =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as SavedSignature).id === 'string' &&
          typeof (entry as SavedSignature).created === 'number' &&
          isSignatureInput({ ...(entry as SavedSignature), png: Buffer.from(String((entry as SavedSignature).png), 'base64') }),
      );
    });
  }

  list(): Promise<SavedSignature[]> {
    return this.#store.read();
  }

  async add(input: SignatureInput): Promise<SavedSignature[]> {
    const entry: SavedSignature = {
      id: randomUUID(),
      kind: input.kind,
      png: Buffer.from(input.png).toString('base64'),
      width: input.width,
      height: input.height,
      created: Date.now(),
    };
    // Neueste zuerst; die ältesten fallen bei Überschreitung der Höchstzahl weg.
    const list = [entry, ...(await this.list())].slice(0, MAX_SIGNATURES);
    await this.#store.write(list);
    return list;
  }

  async remove(id: string): Promise<SavedSignature[]> {
    const list = (await this.list()).filter((entry) => entry.id !== id);
    await this.#store.write(list);
    return list;
  }
}
