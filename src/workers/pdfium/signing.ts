// Digital unterschreiben mit Zertifikat (Phase 7, ADR 0016): PAdES B-B (ETSI.CAdES.detached).
// - Zertifikat und Schlüssel aus der PKCS#12-Datei liest @libpdf/core (P12Signer, auch ältere Verfahren wie 3DES/RC2
//   aus dem macOS-Schlüsselbund); es berechnet auch die eigentliche Signatur mit dem privaten Schlüssel.
// - Das Signaturfeld (sichtbar mit Rahmen, Name, Datum, Grund oder unsichtbar) und den Platzhalter für die Signatur
//   schreibt die App selbst mit pdf-lib inkrementell an das Dokument. Frühere Signaturen bleiben gültig.
// - Die CMS-Struktur (SignedData mit messageDigest und signingCertificateV2, ohne signingTime, wie PAdES verlangt)
//   baut pkijs; sie kommt in den Platzhalter, /ByteRange umfasst alles außer dem Platzhalter.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, type PDFFont, type PDFRef } from '@cantoo/pdf-lib';
import { P12Signer } from '@libpdf/core';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { Rect } from '../../shared/annotations';
import type { SignErrorCode, SignRequestInput } from '../../shared/signing';

export class SignError extends Error {
  constructor(
    readonly code: SignErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SignError';
  }
}

// Name (CN) des Zertifikatsinhabers
export function certificateName(der: Uint8Array): string | null {
  try {
    const asn = asn1js.fromBER(der.slice().buffer as ArrayBuffer);
    const certificate = new pkijs.Certificate({ schema: asn.result });
    const entry = certificate.subject.typesAndValues.find((item) => item.type === '2.5.4.3');
    const value = (entry?.value as { valueBlock?: { value?: unknown } } | undefined)?.valueBlock?.value;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

const formatDate = (date: Date) =>
  `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

// Darstellung des Feldes: Zeilen so groß, wie es in das Rechteck passt
function appearance(lines: Array<{ text: string; bold: boolean }>, width: number, height: number, regular: PDFFont, bold: PDFFont): string {
  const padding = Math.min(6, width * 0.05, height * 0.08);
  const usable = { width: width - 2 * padding, height: height - 2 * padding };
  const weights = lines.map((line) => (line.bold ? 1.3 : 1));
  const total = weights.reduce((sum, weight) => sum + weight * 1.25, 0);
  let unit = usable.height / total;
  for (const [i, line] of lines.entries()) {
    const font = line.bold ? bold : regular;
    const widthAtOne = font.widthOfTextAtSize(line.text, 1) * (weights[i] ?? 1);
    if (widthAtOne > 0) unit = Math.min(unit, usable.width / widthAtOne);
  }
  unit = Math.max(2, Math.min(unit, 14));
  let y = height - padding;
  const parts = ['q 0.15 0.35 0.75 RG 0.8 w', `0.4 0.4 ${(width - 0.8).toFixed(2)} ${(height - 0.8).toFixed(2)} re S`, '0 0 0 rg'];
  for (const [i, line] of lines.entries()) {
    const size = unit * (weights[i] ?? 1);
    y -= size * 1.25;
    const font = line.bold ? 'F2' : 'F1';
    const encoded = (line.bold ? bold : regular).encodeText(line.text).toString();
    parts.push(`BT /${font} ${size.toFixed(2)} Tf ${padding.toFixed(2)} ${(y + size * 0.25).toFixed(2)} Td ${encoded} Tj ET`);
  }
  parts.push('Q');
  return parts.join('\n');
}

// Platz für die Signatur (DER, als Hex doppelt so lang); reicht für RSA 4096 mit Zertifikatskette
const PLACEHOLDER_BYTES = 16384;
// Platzhalter für /ByteRange: vier zehnstellige Zahlen, danach durch die echten Werte ersetzt (gleiche Länge)
const RANGE_PLACEHOLDER = 9_999_999_999;

const pdfDate = (date: Date) => {
  const two = (n: number) => String(n).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
};

// Signaturfeld mit Signaturwörterbuch und Platzhaltern anhängen (sichtbar mit Darstellung oder unsichtbar)
async function addSignatureField(
  bytes: Uint8Array,
  fieldName: string,
  placement: { pageIndex: number; rect: Rect } | null,
  lines: Array<{ text: string; bold: boolean }>,
  info: { reason: string | null; location: string | null; name: string; now: Date },
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new SignError('sign-encrypted', 'Unterschreiben verschlüsselter Dokumente');
  const page = doc.getPage(placement?.pageIndex ?? 0);
  const context = doc.context;
  const signature = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      SubFilter: 'ETSI.CAdES.detached',
      ByteRange: [RANGE_PLACEHOLDER, RANGE_PLACEHOLDER, RANGE_PLACEHOLDER, RANGE_PLACEHOLDER],
      Contents: PDFHexString.of('0'.repeat(PLACEHOLDER_BYTES * 2)),
      M: PDFString.of(pdfDate(info.now)),
      ...(info.name ? { Name: PDFHexString.fromText(info.name) } : {}),
      ...(info.reason ? { Reason: PDFHexString.fromText(info.reason) } : {}),
      ...(info.location ? { Location: PDFHexString.fromText(info.location) } : {}),
    }),
  );
  let widgetEntries: Record<string, unknown>;
  if (placement) {
    const [left, bottom, right, top] = placement.rect;
    const width = right - left;
    const height = top - bottom;
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const stream = context.flateStream(appearance(lines, width, height, regular, bold), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, width, height],
      Resources: { Font: { F1: regular.ref, F2: bold.ref } },
    });
    widgetEntries = { Rect: [left, bottom, right, top], F: 4, AP: { N: context.register(stream) } };
  } else {
    // Unsichtbar: Rechteck ohne Fläche, versteckt und gesperrt (übliche Form unsichtbarer Signaturen)
    widgetEntries = { Rect: [0, 0, 0, 0], F: 132 };
  }
  const widget = context.register(
    context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFHexString.fromText(fieldName),
      P: page.ref,
      V: signature,
      ...widgetEntries,
    } as never),
  );
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(widget);
  else page.node.set(PDFName.of('Annots'), context.obj([widget]));
  const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (acroForm instanceof PDFDict) {
    const fields = acroForm.lookup(PDFName.of('Fields'));
    if (fields instanceof PDFArray) fields.push(widget as PDFRef);
    else acroForm.set(PDFName.of('Fields'), context.obj([widget]));
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  } else {
    doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [widget], SigFlags: 3 }));
  }
  return doc.commit({ useObjectStreams: false });
}

// Freier Feldname „Signatur1“, „Signatur2“ …
async function freeFieldName(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const names = new Set<string>();
  try {
    for (const field of doc.getForm().getFields()) names.add(field.getName());
  } catch {
    // Formular nicht lesbar: dann eben ein Name mit Zeitstempel
    return `Signatur${Date.now()}`;
  }
  for (let n = 1; ; n++) if (!names.has(`Signatur${n}`)) return `Signatur${n}`;
}

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCertificateV2: '1.2.840.113549.1.9.16.2.47',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
  rsaPss: '1.2.840.113549.1.1.10',
  ecdsaSha256: '1.2.840.10045.4.3.2',
} as const;

const toBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i]);
const toHex = (bytes: Uint8Array) => Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
// Byte für Byte als Zeichen (Stellen in Text und Bytes stimmen überein)
const asLatin1 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return text;
};
const sha256 = async (data: Uint8Array) => new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', toBuffer(data)));

// CMS SignedData (detached) für PAdES B-B über die Bytes außerhalb des Platzhalters
async function buildCms(signer: P12Signer, data: Uint8Array): Promise<Uint8Array> {
  pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ name: 'webcrypto', crypto: globalThis.crypto }));
  const chain = [signer.certificate, ...signer.certificateChain.filter((der) => !sameBytes(der, signer.certificate))];
  const certificates = chain.map((der) => new pkijs.Certificate({ schema: asn1js.fromBER(toBuffer(der)).result }));
  const certificate = certificates[0] as pkijs.Certificate;
  const sha256Algorithm = new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 });
  // ESS signing-certificate-v2: Hash des Unterzeichner-Zertifikats (Pflicht bei PAdES)
  const essCertId = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.OctetString({ valueHex: toBuffer(await sha256(signer.certificate)) }),
              new asn1js.Sequence({
                value: [
                  new asn1js.Sequence({ value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [certificate.issuer.toSchema()] })] }),
                  certificate.serialNumber,
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
      new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: toBuffer(await sha256(data)) })] }),
      new pkijs.Attribute({ type: OID.signingCertificateV2, values: [essCertId] }),
    ],
  });
  // Signiert wird die DER-Kodierung der Attribute als SET (Tag 0x31 statt des impliziten [0])
  const encoded = new Uint8Array(signedAttrs.toSchema().toBER(false));
  encoded[0] = 0x31;
  const signatureValue = await signer.sign(encoded, 'SHA-256');
  const signatureAlgorithm =
    signer.keyType === 'EC'
      ? new pkijs.AlgorithmIdentifier({ algorithmId: OID.ecdsaSha256 })
      : new pkijs.AlgorithmIdentifier({ algorithmId: signer.signatureAlgorithm === 'RSA-PSS' ? OID.rsaPss : OID.rsaEncryption, algorithmParams: new asn1js.Null() });
  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
    digestAlgorithm: sha256Algorithm,
    signedAttrs,
    signatureAlgorithm,
    signature: new asn1js.OctetString({ valueHex: toBuffer(signatureValue) }),
  });
  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [sha256Algorithm],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    certificates,
    signerInfos: [signerInfo],
  });
  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

// Platzhalter in den angehängten Bytes finden, /ByteRange eintragen, Signatur berechnen und einsetzen
async function fillSignature(prepared: Uint8Array, signer: P12Signer): Promise<Uint8Array> {
  const text = asLatin1(prepared);
  const contentsStart = text.lastIndexOf(`<${'0'.repeat(PLACEHOLDER_BYTES * 2)}>`);
  // /ByteRange des neuen Signaturwörterbuchs (das letzte in der Datei), Inhalt zwischen den eckigen Klammern
  const rangeKey = text.lastIndexOf('/ByteRange');
  const rangeOpen = text.indexOf('[', rangeKey);
  const rangeClose = text.indexOf(']', rangeOpen);
  if (contentsStart < 0 || rangeKey < 0 || rangeOpen < 0 || rangeClose < 0 || !text.slice(rangeOpen, rangeClose).includes(String(RANGE_PLACEHOLDER))) {
    throw new SignError('sign-certificate', 'Platzhalter fehlt');
  }
  const contentsEnd = contentsStart + PLACEHOLDER_BYTES * 2 + 2;
  const range = [0, contentsStart, contentsEnd, prepared.length - contentsEnd];
  const output = prepared.slice();
  const slot = rangeClose - rangeOpen - 1;
  const value = ` ${range.join(' ')}`.padEnd(slot, ' ');
  if (value.length > slot) throw new SignError('sign-certificate', 'Platzhalter zu klein');
  output.set(new TextEncoder().encode(value), rangeOpen + 1);
  const data = new Uint8Array(contentsStart + (prepared.length - contentsEnd));
  data.set(output.subarray(0, contentsStart), 0);
  data.set(output.subarray(contentsEnd), contentsStart);
  const cms = await buildCms(signer, data);
  if (cms.length > PLACEHOLDER_BYTES) throw new SignError('sign-certificate', 'Signatur zu groß');
  output.set(new TextEncoder().encode(toHex(cms).padEnd(PLACEHOLDER_BYTES * 2, '0')), contentsStart + 1);
  return output;
}

export async function signDocument(bytes: Uint8Array, input: SignRequestInput, now = new Date()): Promise<Uint8Array> {
  let signer: P12Signer;
  try {
    signer = await P12Signer.create(new Uint8Array(input.p12), input.password);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SignError(/password|mac|decrypt|integrity/i.test(message) ? 'sign-password' : 'sign-certificate', message);
  }
  const name = certificateName(signer.certificate) ?? '';
  const fieldName = await freeFieldName(bytes);
  const lines = [
    { text: input.labels.signedBy, bold: false },
    { text: name, bold: true },
    { text: `${input.labels.date} ${formatDate(now)}`, bold: false },
    ...(input.reason ? [{ text: `${input.labels.reason} ${input.reason}`, bold: false }] : []),
  ];
  const prepared = await addSignatureField(bytes, fieldName, input.placement, lines, { reason: input.reason, location: input.location, name, now });
  return fillSignature(prepared, signer);
}
