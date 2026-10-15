// sRGB-Farbprofil (ICC Version 2.1, Klasse „Bildschirm“) für die Ausgabebedingung von PDF/A. Selbst erzeugt aus den
// Werten der Norm IEC 61966-2-1: Primärfarben und Weißpunkt (an D50 angepasst, wie ICC verlangt) und die sRGB-Kurve
// als Tabelle. So braucht die App keine fremde Profildatei.

const D50 = [0.9642, 1, 0.8249];
// sRGB-Primärfarben nach Bradford-Anpassung an D50
const PRIMARIES = {
  r: [0.4361, 0.2225, 0.0139],
  g: [0.3851, 0.7169, 0.0971],
  b: [0.1431, 0.0606, 0.7141],
};

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const s15Fixed16 = (value: number) => u32(Math.round(value * 65536) >>> 0);
const pad4 = (bytes: number[]) => [...bytes, ...new Array((4 - (bytes.length % 4)) % 4).fill(0)];

const xyz = (values: number[]) => [...ascii('XYZ '), 0, 0, 0, 0, ...values.flatMap(s15Fixed16)];

// textDescriptionType (ICC v2): ASCII-Beschreibung, leere Unicode- und ScriptCode-Teile
function description(text: string): number[] {
  return [...ascii('desc'), 0, 0, 0, 0, ...u32(text.length + 1), ...ascii(text), 0, ...u32(0), ...u32(0), ...u16(0), 0, ...new Array(67).fill(0)];
}

const textType = (text: string) => [...ascii('text'), 0, 0, 0, 0, ...ascii(text), 0];

// sRGB-Kurve als Tabelle mit 1024 Werten
function srgbCurve(): number[] {
  const points = 1024;
  const values: number[] = [];
  for (let i = 0; i < points; i++) {
    const v = i / (points - 1);
    const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    values.push(...u16(Math.round(linear * 65535)));
  }
  return [...ascii('curv'), 0, 0, 0, 0, ...u32(points), ...values];
}

export function srgbProfile(): Uint8Array {
  const curve = pad4(srgbCurve());
  const tags: Array<[string, number[]]> = [
    ['desc', pad4(description('sRGB IEC61966-2.1'))],
    ['cprt', pad4(textType('No copyright, use freely'))],
    ['wtpt', xyz(D50)],
    ['rXYZ', xyz(PRIMARIES.r)],
    ['gXYZ', xyz(PRIMARIES.g)],
    ['bXYZ', xyz(PRIMARIES.b)],
    ['rTRC', curve],
  ];
  // Grün- und Blaukurve teilen sich die Daten der Rotkurve
  const shared = ['gTRC', 'bTRC'];
  const tableSize = 4 + (tags.length + shared.length) * 12;
  let offset = 128 + tableSize;
  const table: number[] = [...u32(tags.length + shared.length)];
  const data: number[] = [];
  let curveOffset = 0;
  for (const [signature, bytes] of tags) {
    table.push(...ascii(signature), ...u32(offset), ...u32(bytes.length));
    if (signature === 'rTRC') curveOffset = offset;
    data.push(...bytes);
    offset += bytes.length;
  }
  for (const signature of shared) table.push(...ascii(signature), ...u32(curveOffset), ...u32(curve.length));
  const size = 128 + table.length + data.length;
  const header = [
    ...u32(size),
    ...u32(0), // bevorzugtes CMM
    0x02, 0x10, 0, 0, // Version 2.1
    ...ascii('mntr'),
    ...ascii('RGB '),
    ...ascii('XYZ '),
    ...u16(2026), ...u16(1), ...u16(1), ...u16(0), ...u16(0), ...u16(0),
    ...ascii('acsp'),
    ...u32(0), // Plattform
    ...u32(0), // Flags
    ...u32(0), // Hersteller
    ...u32(0), // Modell
    ...u32(0), ...u32(0), // Attribute
    ...u32(0), // Absicht: perzeptiv
    ...D50.flatMap(s15Fixed16),
    ...u32(0), // Ersteller
    ...new Array(16).fill(0), // Profil-ID
    ...new Array(28).fill(0), // reserviert
  ];
  return new Uint8Array([...header, ...table, ...data]);
}
