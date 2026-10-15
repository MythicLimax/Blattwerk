// Breiten der Glyphen einer CFF-Schrift (Type1C), nach Glyphenname. PDF/A verlangt, dass /Widths im Schriftwörterbuch
// genau zur eingebetteten Schrift passt; die in PDFium eingebauten Standardschriften weichen bei einzelnen Zeichen
// (z. B. Euro) von den Normmaßen ab. Gelesen werden Top DICT, Private DICT, Zeichensatz und der Anfang jedes
// Charstrings (Typ 2, mit Unterprogrammen) bis zur Breitenangabe.
import { CFF_STANDARD_STRINGS } from './font-tables';
const STANDARD_STRINGS_COUNT = 391;

function readIndex(data: Uint8Array, start: number): { items: Uint8Array[]; end: number } {
  const count = (data[start]! << 8) | data[start + 1]!;
  if (count === 0) return { items: [], end: start + 2 };
  const offSize = data[start + 2]!;
  const offset = (i: number) => {
    let value = 0;
    for (let k = 0; k < offSize; k++) value = (value << 8) | data[start + 3 + i * offSize + k]!;
    return value;
  };
  const base = start + 3 + (count + 1) * offSize - 1;
  const items: Uint8Array[] = [];
  for (let i = 0; i < count; i++) items.push(data.subarray(base + offset(i), base + offset(i + 1)));
  return { items, end: base + offset(count) };
}

function readDict(data: Uint8Array): Map<number, number[]> {
  const result = new Map<number, number[]>();
  let operands: number[] = [];
  for (let i = 0; i < data.length; ) {
    const b = data[i]!;
    if (b <= 21) {
      const op = b === 12 ? 1200 + data[i + 1]! : b;
      i += b === 12 ? 2 : 1;
      result.set(op, operands);
      operands = [];
    } else if (b === 28) {
      operands.push(((data[i + 1]! << 24) | (data[i + 2]! << 16)) >> 16);
      i += 3;
    } else if (b === 29) {
      operands.push((data[i + 1]! << 24) | (data[i + 2]! << 16) | (data[i + 3]! << 8) | data[i + 4]!);
      i += 5;
    } else if (b === 30) {
      // Kommazahl (BCD); als 0 gezählt, für die Breiten nicht gebraucht
      i++;
      while (i < data.length && (data[i]! & 0x0f) !== 0x0f && (data[i]! >> 4) !== 0x0f) i++;
      i++;
      operands.push(0);
    } else if (b >= 32 && b <= 246) {
      operands.push(b - 139);
      i++;
    } else if (b <= 250) {
      operands.push((b - 247) * 256 + data[i + 1]! + 108);
      i += 2;
    } else {
      operands.push(-(b - 251) * 256 - data[i + 1]! - 108);
      i += 2;
    }
  }
  return result;
}

const bias = (count: number) => (count < 1240 ? 107 : count < 33900 ? 1131 : 32768);

// Breite steht als erster Operand vor dem ersten Stamm- oder Bewegungsbefehl, wenn dessen Operandenzahl „zu viel“ ist.
// Unterprogramme (callsubr, callgsubr) werden dabei ausgeführt.
function charstringWidth(code: Uint8Array, defaultWidth: number, nominalWidth: number, local: Uint8Array[], global: Uint8Array[]): number {
  const stack: number[] = [];
  const run = (program: Uint8Array, depth: number): number | null => {
    for (let i = 0; i < program.length; ) {
      const b = program[i]!;
      if (b >= 32 || b === 28) {
        if (b === 28) {
          stack.push(((program[i + 1]! << 24) | (program[i + 2]! << 16)) >> 16);
          i += 3;
        } else if (b <= 246) {
          stack.push(b - 139);
          i++;
        } else if (b <= 250) {
          stack.push((b - 247) * 256 + program[i + 1]! + 108);
          i += 2;
        } else if (b <= 254) {
          stack.push(-(b - 251) * 256 - program[i + 1]! - 108);
          i += 2;
        } else {
          stack.push(((program[i + 1]! << 24) | (program[i + 2]! << 16) | (program[i + 3]! << 8) | program[i + 4]!) / 65536);
          i += 5;
        }
        continue;
      }
      if ((b === 10 || b === 29) && depth < 10) {
        const subrs = b === 10 ? local : global;
        const index = (stack.pop() ?? 0) + bias(subrs.length);
        const result = run(subrs[index] ?? new Uint8Array(), depth + 1);
        if (result !== null) return result;
        i++;
        continue;
      }
      if (b === 11) return null; // return aus einem Unterprogramm
      const withWidth = (count: number) => (stack.length > count ? nominalWidth + stack[0]! : defaultWidth);
      if ([1, 3, 18, 23, 19, 20].includes(b)) return stack.length % 2 === 1 ? nominalWidth + stack[0]! : defaultWidth;
      if (b === 21) return withWidth(2);
      if (b === 22 || b === 4) return withWidth(1);
      if (b === 14) return stack.length === 1 || stack.length === 5 ? nominalWidth + stack[0]! : defaultWidth;
      return defaultWidth;
    }
    return null;
  };
  return run(code, 0) ?? defaultWidth;
}

export function cffWidths(data: Uint8Array): Map<string, number> {
  const standardStrings = CFF_STANDARD_STRINGS;
  const headerSize = data[2]!;
  const names = readIndex(data, headerSize);
  const topDicts = readIndex(data, names.end);
  const strings = readIndex(data, topDicts.end);
  const top = readDict(topDicts.items[0]!);
  const stringOf = (sid: number) => (sid < STANDARD_STRINGS_COUNT ? standardStrings[sid]! : new TextDecoder('latin1').decode(strings.items[sid - STANDARD_STRINGS_COUNT]));
  const charStrings = readIndex(data, top.get(17)![0]!).items;
  const globalSubrs = readIndex(data, strings.end).items;
  const [privateSize, privateOffset] = top.get(18)!;
  const priv = readDict(data.subarray(privateOffset!, privateOffset! + privateSize!));
  const defaultWidth = priv.get(20)?.[0] ?? 0;
  const nominalWidth = priv.get(21)?.[0] ?? 0;
  const localSubrs = priv.has(19) ? readIndex(data, privateOffset! + priv.get(19)![0]!).items : [];
  // Zeichensatz (charset): Glyphe 0 ist .notdef
  const charsetOffset = top.get(15)?.[0] ?? 0;
  const glyphNames = ['.notdef'];
  if (charsetOffset > 2) {
    const format = data[charsetOffset]!;
    let p = charsetOffset + 1;
    while (glyphNames.length < charStrings.length) {
      if (format === 0) {
        glyphNames.push(stringOf((data[p]! << 8) | data[p + 1]!));
        p += 2;
      } else {
        const first = (data[p]! << 8) | data[p + 1]!;
        const left = format === 1 ? data[p + 2]! : (data[p + 2]! << 8) | data[p + 3]!;
        p += format === 1 ? 3 : 4;
        for (let k = 0; k <= left && glyphNames.length < charStrings.length; k++) glyphNames.push(stringOf(first + k));
      }
    }
  }
  const widths = new Map<string, number>();
  charStrings.forEach((code, gid) => widths.set(glyphNames[gid] ?? `gid${gid}`, charstringWidth(code, defaultWidth, nominalWidth, localSubrs, globalSubrs)));
  return widths;
}
