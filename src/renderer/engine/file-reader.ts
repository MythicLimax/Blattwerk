import { MAX_READ_CHUNK } from '../../shared/ipc';

export type ReadRangeFn = (begin: number, end: number) => Promise<Uint8Array>;

// Liest einen Bereich in Stücken von höchstens MAX_READ_CHUNK Bytes und setzt ihn zusammen.
export async function readChunked(read: ReadRangeFn, begin: number, end: number, chunkSize = MAX_READ_CHUNK): Promise<Uint8Array> {
  const length = end - begin;
  if (length <= chunkSize) return read(begin, end);
  const result = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const chunkEnd = Math.min(begin + offset + chunkSize, end);
    const chunk = await read(begin + offset, chunkEnd);
    result.set(chunk, offset);
    offset += chunk.length;
    if (chunk.length === 0) break;
  }
  return offset === length ? result : result.subarray(0, offset);
}
