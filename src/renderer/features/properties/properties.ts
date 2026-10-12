// Aufbereitung der Dokumenteigenschaften ohne DOM, damit sie testbar bleibt.

const MM_PER_POINT = 25.4 / 72;

const PAGE_SIZE_NAMES: Array<{ name: string; width: number; height: number }> = [
  { name: 'A3', width: 297, height: 420 },
  { name: 'A4', width: 210, height: 297 },
  { name: 'A5', width: 148, height: 210 },
  { name: 'Letter', width: 215.9, height: 279.4 },
  { name: 'Legal', width: 215.9, height: 355.6 },
];

export interface PageSizeInfo {
  width: string;
  height: string;
  unit: 'mm';
  name: string | null;
  orientation: 'portrait' | 'landscape';
}

const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function describePageSize(widthPt: number, heightPt: number): PageSizeInfo {
  const widthMm = widthPt * MM_PER_POINT;
  const heightMm = heightPt * MM_PER_POINT;
  const short = Math.min(widthMm, heightMm);
  const long = Math.max(widthMm, heightMm);
  const match = PAGE_SIZE_NAMES.find((s) => Math.abs(s.width - short) < 1.5 && Math.abs(s.height - long) < 1.5);
  return {
    width: numberFormat.format(widthMm),
    height: numberFormat.format(heightMm),
    unit: 'mm',
    name: match?.name ?? null,
    orientation: widthMm > heightMm ? 'landscape' : 'portrait',
  };
}

export function formatFileSize(bytes: number): { size: string; bytes: string } {
  const exact = new Intl.NumberFormat('de-DE').format(bytes);
  const units = ['Byte', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const short = unit === 0 ? `${exact} Byte` : `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
  return { size: short, bytes: exact };
}

// PDF-Datum "D:YYYYMMDDHHmmSSOHH'mm'" (alles nach dem Jahr optional) in ein Date umwandeln.
export function parsePdfDate(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  const match = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?'?/.exec(input.trim());
  if (!match) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  if (sign === '+' || sign === '-') {
    const offset = (Number(oh) * 60 + Number(om)) * 60_000;
    utc += sign === '+' ? -offset : offset;
  } else if (!sign) {
    // Ohne Zeitzone: als lokale Zeit deuten, wie Acrobat es tut.
    return new Date(year, month - 1, day, hour, minute, second);
  }
  return new Date(utc);
}

export const PERMISSION_FLAGS = {
  print: 4,
  modify: 8,
  copy: 16,
  annotate: 32,
  fillForms: 256,
  assemble: 1024,
} as const;

export type PermissionKey = keyof typeof PERMISSION_FLAGS;

// pdf.js liefert null, wenn es keine Einschränkungen gibt, sonst die Menge der erlaubten Flags.
export function deniedPermissions(allowed: ReadonlySet<number> | null): PermissionKey[] {
  if (allowed === null) return [];
  return (Object.keys(PERMISSION_FLAGS) as PermissionKey[]).filter((key) => !allowed.has(PERMISSION_FLAGS[key]));
}
