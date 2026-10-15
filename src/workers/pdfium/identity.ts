// Eigene digitale ID erstellen (Phase 7, ADR 0016): RSA-Schlüssel (2048 Bit) und selbst ausgestelltes Zertifikat,
// gespeichert als PKCS#12-Datei (.p12) mit modernem Kennwortschutz (PBES2: AES-256, PBKDF2 mit SHA-256, MAC SHA-256).
// Das Zertifikat bestätigt keine Stelle; Prüfprogramme zeigen „Identität nicht bestätigt“, bis man ihm vertraut.
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

export interface IdentityInput {
  name: string;
  organization: string | null;
  email: string | null;
  password: string;
  // Gültigkeit in Jahren
  years: number;
}

const OID = {
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  email: '1.2.840.113549.1.9.1',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  pkcs8ShroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  friendlyName: '1.2.840.113549.1.9.20',
  localKeyId: '1.2.840.113549.1.9.21',
} as const;

const ITERATIONS = 100_000;
// pkijs erzeugt den Initialisierungsvektor selbst; der Typ verlangt ihn trotzdem
const AES_256 = { name: 'AES-CBC', length: 256 } as pkijs.ContentEncryptionAlgorithm;
const toBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

function names(input: IdentityInput): pkijs.AttributeTypeAndValue[] {
  const entries = [new pkijs.AttributeTypeAndValue({ type: OID.commonName, value: new asn1js.Utf8String({ value: input.name }) })];
  if (input.organization) entries.push(new pkijs.AttributeTypeAndValue({ type: OID.organization, value: new asn1js.Utf8String({ value: input.organization }) }));
  if (input.email) entries.push(new pkijs.AttributeTypeAndValue({ type: OID.email, value: new asn1js.IA5String({ value: input.email }) }));
  return entries;
}

export async function createIdentity(input: IdentityInput, now = new Date()): Promise<Uint8Array> {
  const crypto = globalThis.crypto;
  pkijs.setEngine('webcrypto', new pkijs.CryptoEngine({ name: 'webcrypto', crypto }));
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ valueHex: toBuffer(crypto.getRandomValues(new Uint8Array(16)).map((b, i) => (i === 0 ? b & 0x7f : b))) });
  certificate.subject.typesAndValues = names(input);
  certificate.issuer.typesAndValues = names(input);
  certificate.notBefore.value = now;
  const until = new Date(now);
  until.setFullYear(until.getFullYear() + input.years);
  certificate.notAfter.value = until;
  // Kein Zertifizierungsstellen-Zertifikat; Schlüssel für Signaturen und Nichtabstreitbarkeit
  const keyUsage = new asn1js.BitString({ valueHex: new Uint8Array([0b11000000]).buffer, unusedBits: 6 });
  certificate.extensions = [
    new pkijs.Extension({ extnID: OID.basicConstraints, critical: true, extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false) }),
    new pkijs.Extension({ extnID: OID.keyUsage, critical: true, extnValue: keyUsage.toBER(false) }),
  ];
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, 'SHA-256');

  const password = toBuffer(new TextEncoder().encode(input.password));
  const localKeyId = new asn1js.OctetString({ valueHex: await crypto.subtle.digest('SHA-1', certificate.toSchema().toBER(false)) });
  const attributes = [
    new pkijs.Attribute({ type: OID.friendlyName, values: [new asn1js.BmpString({ value: input.name })] }),
    new pkijs.Attribute({ type: OID.localKeyId, values: [localKeyId] }),
  ];
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const keyBag = new pkijs.PKCS8ShroudedKeyBag({ parsedValue: new pkijs.PrivateKeyInfo({ schema: asn1js.fromBER(toBuffer(pkcs8)).result }) });
  await keyBag.makeInternalValues({ password, contentEncryptionAlgorithm: AES_256, hmacHashAlgorithm: 'SHA-256', iterationCount: ITERATIONS });
  const certBag = new pkijs.CertBag({ parsedValue: certificate });

  const authenticatedSafe = new pkijs.AuthenticatedSafe({
    parsedValue: {
      safeContents: [
        { privacyMode: 0, value: new pkijs.SafeContents({ safeBags: [new pkijs.SafeBag({ bagId: OID.pkcs8ShroudedKeyBag, bagValue: keyBag, bagAttributes: attributes })] }) },
        { privacyMode: 1, value: new pkijs.SafeContents({ safeBags: [new pkijs.SafeBag({ bagId: OID.certBag, bagValue: certBag, bagAttributes: attributes })] }) },
      ],
    },
  });
  await authenticatedSafe.makeInternalValues({
    safeContents: [{}, { password, contentEncryptionAlgorithm: AES_256, hmacHashAlgorithm: 'SHA-256', iterationCount: ITERATIONS }],
  });
  const pfx = new pkijs.PFX({ parsedValue: { integrityMode: 0, authenticatedSafe } });
  await pfx.makeInternalValues({ password, iterations: ITERATIONS, pbkdf2HashAlgorithm: 'SHA-256', hmacHashAlgorithm: 'SHA-256' });
  return new Uint8Array(pfx.toSchema().toBER(false));
}
