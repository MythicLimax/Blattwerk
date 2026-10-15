// Digitale Signaturen (Phase 7): unterschreiben (PAdES B-B, sichtbar und unsichtbar) und prüfen.
import { init } from '@embedpdf/pdfium';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { summarize, type SignRequestInput } from '../../src/shared/signing';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { signDocument } from '../../src/workers/pdfium/signing';
import { verifySignatures } from '../../src/workers/pdfium/signatures';
import { fixture } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
let engine: PdfiumEngine;
const p12 = () => {
  const bytes = readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'certs', 'test-id.p12'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const LABELS = { signedBy: 'Digital unterschrieben von', date: 'Datum:', reason: 'Grund:' };
const input = (extra: Partial<SignRequestInput> = {}): SignRequestInput => ({
  p12: p12(),
  password: 'test',
  reason: 'Freigabe',
  location: 'Berlin',
  placement: { pageIndex: 0, rect: [350, 60, 550, 120] },
  labels: LABELS,
  ...extra,
});

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

function qpdfCheck(bytes: Uint8Array): void {
  try {
    execFileSync('qpdf', ['--version'], { stdio: 'ignore' });
  } catch {
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    writeFileSync(path.join(dir, 'a.pdf'), bytes);
    execFileSync('qpdf', ['--check', path.join(dir, 'a.pdf')], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Digitale Signaturen', () => {
  it('unterschreibt sichtbar (PAdES) und prüft die Signatur als gültig', async () => {
    const original = new Uint8Array(readFileSync(fixture('text.pdf')));
    const signed = await signDocument(original, input(), new Date('2026-10-15T10:30:00Z'));
    // Inkrementell: das Original steht unverändert am Anfang
    expect(Buffer.from(signed.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    expect(Buffer.from(signed).toString('latin1')).toContain('ETSI.CAdES.detached');
    const [check, ...rest] = await verifySignatures(signed);
    expect(rest).toEqual([]);
    expect(check).toMatchObject({
      status: 'valid',
      coversDocument: true,
      signer: 'Erika Mustermann',
      organization: 'Blattwerk Test',
      reason: 'Freigabe',
      location: 'Berlin',
      selfSigned: true,
      certificateValidAtSigning: true,
      pageIndex: 0,
    });
    expect(summarize([check!])).toBe('valid');
    // Darstellung: Name steht auf der Seite (PDFium zeichnet das Feld)
    const { id } = engine.sessions.open(signed, null);
    const page = engine.sessions.render(id, 0, 72, 1e8);
    engine.sessions.close(id);
    const dark = (x: number, y: number) => (page.rgba[(y * page.width + x) * 4] ?? 255) < 128;
    let ink = 0;
    for (let y = 842 - 120; y < 842 - 60; y++) for (let x = 350; x < 550; x++) if (dark(x, y)) ink++;
    expect(ink).toBeGreaterThan(100);
    qpdfCheck(signed);
  });

  it('erkennt Änderungen nach dem Unterschreiben und verfälschte Dokumente', async () => {
    const signed = await signDocument(new Uint8Array(readFileSync(fixture('text.pdf'))), input({ placement: null }));
    // Später angehängter Kommentar: Signatur gültig, deckt aber nicht mehr alles ab
    const commented = engine.process(signed, null, {
      upserts: [
        {
          appearance: true,
          annotation: { id: 'n', ref: null, kind: 'square', pageIndex: 0, rect: [100, 100, 150, 150], color: { r: 1, g: 0, b: 0 }, opacity: 1, contents: '', author: 'T', created: '', modified: '', replies: [], statuses: [], width: 1, fill: null },
        },
      ],
      deletions: [],
    }, [], { incremental: true });
    const [later] = await verifySignatures(commented);
    expect(later).toMatchObject({ status: 'valid', coversDocument: false });
    expect(summarize([later!])).toBe('changed');
    // Ein Byte im unterschriebenen Bereich verändert: ungültig
    const forged = signed.slice();
    // Ein Byte im Kommentar der zweiten Zeile (unterschriebener Bereich, ohne die Struktur zu stören) verändern
    const at = Buffer.from(forged).indexOf('\n%') + 2;
    forged[at] = (forged[at] ?? 0) ^ 1;
    const [broken] = await verifySignatures(forged);
    expect(broken?.status).toBe('invalid');
    expect(summarize([broken!])).toBe('invalid');
  });

  it('zwei Signaturen nacheinander bleiben beide gültig; falsches Kennwort', async () => {
    const once = await signDocument(new Uint8Array(readFileSync(fixture('text.pdf'))), input());
    const twice = await signDocument(once, input({ placement: { pageIndex: 0, rect: [50, 60, 250, 120] } }));
    const checks = await verifySignatures(twice);
    expect(checks.map((check) => [check.field, check.status, check.coversDocument])).toEqual([
      ['Signatur1', 'valid', false],
      ['Signatur2', 'valid', true],
    ]);
    expect(summarize(checks)).toBe('valid');
    await expect(signDocument(new Uint8Array(readFileSync(fixture('text.pdf'))), input({ password: 'falsch' }))).rejects.toMatchObject({ code: 'sign-password' });
  });

  it('Dokumente ohne Signatur', async () => {
    expect(await verifySignatures(new Uint8Array(readFileSync(fixture('formular.pdf'))))).toEqual([]);
    expect(summarize([])).toBe('none');
  });
});

describe('Eigene digitale ID', () => {
  it('erstellt eine .p12-Datei, mit der sich unterschreiben lässt', async () => {
    const { createIdentity } = await import('../../src/workers/pdfium/identity');
    const p12Bytes = await createIdentity({ name: 'Max Muster', organization: 'Beispiel GmbH', email: 'max@example.com', password: 'geheim1', years: 5 });
    const signed = await signDocument(new Uint8Array(readFileSync(fixture('text.pdf'))), input({ p12: p12Bytes.slice().buffer as ArrayBuffer, password: 'geheim1' }));
    const [check] = await verifySignatures(signed);
    expect(check).toMatchObject({ status: 'valid', signer: 'Max Muster', organization: 'Beispiel GmbH', selfSigned: true, certificateValidAtSigning: true });
    await expect(signDocument(signed, input({ p12: p12Bytes.slice().buffer as ArrayBuffer, password: 'falsch' }))).rejects.toMatchObject({ code: 'sign-password' });
    // Auch mit OpenSSL lesbar (wie andere Programme), falls vorhanden
    try {
      const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-p12-'));
      writeFileSync(path.join(dir, 'id.p12'), p12Bytes);
      const out = execFileSync('/usr/bin/openssl', ['pkcs12', '-info', '-in', path.join(dir, 'id.p12'), '-passin', 'pass:geheim1', '-noout'], { encoding: 'utf8', stdio: 'pipe' });
      rmSync(dir, { recursive: true, force: true });
      expect(out).toBeDefined();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }, 60_000);
});
