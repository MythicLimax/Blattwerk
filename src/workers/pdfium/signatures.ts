// Digitale Signaturen prüfen (Phase 7, ADR 0016). Struktur mit @cantoo/pdf-lib, Kryptografie mit pkijs (WebCrypto).
// Geprüft wird je Signatur: Ist die Signatur über die angegebenen Bytes mathematisch gültig, deckt sie das ganze
// Dokument ab oder wurde danach noch etwas angehängt, wer hat unterschrieben, war das Zertifikat zum Zeitpunkt gültig.
// Eine Vertrauensliste (Stammzertifikate) gibt es nicht: Die Identität gilt deshalb immer als „nicht bestätigt“.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, type PDFObject } from '@cantoo/pdf-lib';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import type { SignatureCheck } from '../../shared/signing';

const NAME = {
  AcroForm: PDFName.of('AcroForm'),
  Fields: PDFName.of('Fields'),
  Kids: PDFName.of('Kids'),
  FT: PDFName.of('FT'),
  Sig: PDFName.of('Sig'),
  V: PDFName.of('V'),
  T: PDFName.of('T'),
  Parent: PDFName.of('Parent'),
  ByteRange: PDFName.of('ByteRange'),
  Contents: PDFName.of('Contents'),
  SubFilter: PDFName.of('SubFilter'),
  M: PDFName.of('M'),
  Name: PDFName.of('Name'),
  Reason: PDFName.of('Reason'),
  Location: PDFName.of('Location'),
  Annots: PDFName.of('Annots'),
  Rect: PDFName.of('Rect'),
} as const;

const OID = {
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  signingTime: '1.2.840.113549.1.9.5',
} as const;

let engineReady = false;
function ensureEngine(): void {
  if (engineReady) return;
  pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ name: 'webcrypto', crypto: globalThis.crypto }));
  engineReady = true;
}

const text = (value: PDFObject | undefined): string | null =>
  value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : value instanceof PDFName ? value.decodeText() : null;

// PDF-Datum „D:20261015120000+02'00'“ als ISO-Zeit
function pdfDate(value: string | null): string | null {
  const match = value ? /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(value) : null;
  if (!match) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = match;
  const zone = !sign || sign.toUpperCase() === 'Z' ? 'Z' : `${sign}${oh}:${om}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nameOf(name: pkijs.RelativeDistinguishedNames, oid: string): string | null {
  const entry = name.typesAndValues.find((item) => item.type === oid);
  const value = entry?.value as { valueBlock?: { value?: unknown } } | undefined;
  return typeof value?.valueBlock?.value === 'string' ? value.valueBlock.value : null;
}

const hexBytes = (value: PDFObject | undefined): Uint8Array | null => {
  if (value instanceof PDFHexString) return value.asBytes();
  if (value instanceof PDFString) return value.asBytes();
  return null;
};

interface FoundSignature {
  field: string;
  dict: PDFDict;
  widget: PDFRef | null;
}

// Signaturfelder mit Wert (/V) im Formularbaum
function findSignatures(doc: PDFDocument): FoundSignature[] {
  const found: FoundSignature[] = [];
  const acroForm = doc.catalog.lookup(NAME.AcroForm);
  if (!(acroForm instanceof PDFDict)) return found;
  const visit = (ref: PDFObject, prefix: string, inheritedType: PDFObject | undefined, depth: number) => {
    if (depth > 32) return;
    const node = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(node instanceof PDFDict)) return;
    const partial = text(node.get(NAME.T));
    const name = partial ? (prefix ? `${prefix}.${partial}` : partial) : prefix;
    const type = node.get(NAME.FT) ?? inheritedType;
    const kids = node.lookup(NAME.Kids);
    if (kids instanceof PDFArray) for (const kid of kids.asArray()) visit(kid, name, type, depth + 1);
    const value = node.lookup(NAME.V);
    if (type === NAME.Sig && value instanceof PDFDict && value.get(NAME.ByteRange)) {
      found.push({ field: name, dict: value, widget: ref instanceof PDFRef ? ref : null });
    }
  };
  const fields = acroForm.lookup(NAME.Fields);
  if (fields instanceof PDFArray) for (const field of fields.asArray()) visit(field, '', undefined, 0);
  return found;
}

// Seite, auf der das Feld (bzw. sein Widget) steht
function pageOf(doc: PDFDocument, widget: PDFRef | null): number | null {
  if (!widget) return null;
  let pages: ReturnType<PDFDocument['getPages']>;
  try {
    pages = doc.getPages();
  } catch {
    // Seitenbaum nicht lesbar (beschädigte Datei)
    return null;
  }
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i]?.node.lookup(NAME.Annots);
    if (!(annots instanceof PDFArray)) continue;
    for (const entry of annots.asArray()) {
      if (!(entry instanceof PDFRef)) continue;
      if (entry === widget || (entry.objectNumber === widget.objectNumber && entry.generationNumber === widget.generationNumber)) return i;
      const annot = doc.context.lookup(entry);
      const parent = annot instanceof PDFDict ? annot.get(NAME.Parent) : undefined;
      if (parent instanceof PDFRef && parent.objectNumber === widget.objectNumber) return i;
    }
  }
  return null;
}

async function checkOne(bytes: Uint8Array, doc: PDFDocument, found: FoundSignature): Promise<SignatureCheck> {
  const { dict } = found;
  const subFilter = text(dict.get(NAME.SubFilter));
  const base: SignatureCheck = {
    field: found.field,
    pageIndex: pageOf(doc, found.widget),
    signer: text(dict.get(NAME.Name)),
    organization: null,
    issuer: null,
    signedAt: pdfDate(text(dict.get(NAME.M))),
    reason: text(dict.get(NAME.Reason)),
    location: text(dict.get(NAME.Location)),
    subFilter,
    status: 'invalid',
    coversDocument: false,
    certificateValidAtSigning: null,
    selfSigned: null,
  };
  const range = dict.lookup(NAME.ByteRange);
  const numbers = range instanceof PDFArray ? range.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : NaN)) : [];
  const contents = hexBytes(dict.get(NAME.Contents));
  const [start0, length0, start1, length1] = numbers;
  if (numbers.length !== 4 || numbers.some((n) => !Number.isInteger(n) || n < 0) || !contents || start0 !== 0) return { ...base, status: 'malformed' };
  if ((length0 as number) > bytes.length || (start1 as number) + (length1 as number) > bytes.length || (start1 as number) < (length0 as number)) {
    return { ...base, status: 'malformed' };
  }
  if (subFilter !== 'adbe.pkcs7.detached' && subFilter !== 'ETSI.CAdES.detached') return { ...base, status: 'unsupported' };
  const signedData = new Uint8Array((length0 as number) + (length1 as number));
  signedData.set(bytes.subarray(0, length0), 0);
  signedData.set(bytes.subarray(start1, (start1 as number) + (length1 as number)), length0);
  // Die Signatur deckt das Dokument ab, wenn danach nichts mehr angehängt wurde
  const coversDocument = (start1 as number) + (length1 as number) === bytes.length;
  try {
    ensureEngine();
    const asn = asn1js.fromBER(contents.slice().buffer as ArrayBuffer);
    if (asn.offset === -1) return { ...base, coversDocument, status: 'malformed' };
    const info = new pkijs.ContentInfo({ schema: asn.result });
    const signed = new pkijs.SignedData({ schema: info.content });
    const result = await signed.verify({ signer: 0, data: signedData.buffer as ArrayBuffer, checkChain: false, extendedMode: true });
    const certificate = result.signerCertificate;
    const signingTimeAttribute = signed.signerInfos[0]?.signedAttrs?.attributes.find((attribute) => attribute.type === OID.signingTime);
    const signingTime = (signingTimeAttribute?.values[0] as { toDate?: () => Date } | undefined)?.toDate?.();
    const signedAt = base.signedAt ?? (signingTime ? signingTime.toISOString() : null);
    const at = signedAt ? new Date(signedAt) : new Date();
    return {
      ...base,
      signedAt,
      signer: certificate ? (nameOf(certificate.subject, OID.commonName) ?? base.signer) : base.signer,
      organization: certificate ? nameOf(certificate.subject, OID.organization) : null,
      issuer: certificate ? nameOf(certificate.issuer, OID.commonName) : null,
      coversDocument,
      status: result.signatureVerified ? 'valid' : 'invalid',
      certificateValidAtSigning: certificate ? certificate.notBefore.value <= at && at <= certificate.notAfter.value : null,
      selfSigned: certificate ? certificate.subject.isEqual(certificate.issuer) : null,
    };
  } catch {
    // Fehler beim Prüfen (z. B. veränderte Bytes, unbekanntes Verfahren) gelten als ungültig
    return { ...base, coversDocument, status: 'invalid' };
  }
}

export async function verifySignatures(bytes: Uint8Array): Promise<SignatureCheck[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  const found = findSignatures(doc);
  const results: SignatureCheck[] = [];
  for (const signature of found) results.push(await checkOne(bytes, doc, signature));
  return results;
}
