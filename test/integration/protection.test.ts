// Kennwortschutz und Berechtigungen (Phase 6): lesen, setzen, ändern, entfernen. PDFium entfernt den alten Schutz,
// pdf-lib verschlüsselt neu (AES-256). Geprüft mit PDFium, pdf.js und qpdf (falls vorhanden).
import { init } from '@embedpdf/pdfium';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ShapeAnnotation } from '../../src/shared/annotations';
import { ALL_PERMISSIONS, checkSecurityInput, type SecuritySettings } from '../../src/shared/security';
import { PdfiumEngine } from '../../src/workers/pdfium/engine';
import { encryptDocument } from '../../src/workers/pdfium/protection';
import { fixture, PASSWORDS } from '../fixtures/expectations';

const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.mjs'),
).href;

let engine: PdfiumEngine;
const none = { upserts: [], deletions: [] };

beforeAll(async () => {
  const wasm = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
  m.PDFiumExt_Init();
  engine = new PdfiumEngine(m);
});

const read = (name: string) => new Uint8Array(readFileSync(fixture(name)));

// Wie der Worker: Schutz entfernen, auf Wunsch neu verschlüsseln
async function protect(bytes: Uint8Array, password: string | null, settings: SecuritySettings | null): Promise<Uint8Array> {
  const plain = engine.process(bytes, password, none, [], { incremental: false, removeSecurity: true });
  return settings ? encryptDocument(plain, settings) : plain;
}

async function pdfjsOpen(bytes: Uint8Array, password?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
    return { pages: doc.numPages, text, permissions: await doc.getPermissions() };
  } finally {
    await task.destroy();
  }
}

function qpdfCheck(bytes: Uint8Array, password: string): void {
  try {
    execFileSync('qpdf', ['--version'], { stdio: 'ignore' });
  } catch {
    return;
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'blattwerk-qpdf-'));
  try {
    const file = path.join(dir, 'a.pdf');
    writeFileSync(file, bytes);
    execFileSync('qpdf', ['--check', `--password=${password}`, file], { stdio: 'pipe' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('Kennwortschutz', () => {
  it('liest Schutz und Berechtigungen', () => {
    expect(engine.security(read('text.pdf'), null)).toMatchObject({ encrypted: false, ownerAccess: true });
    const user = engine.security(read('verschluesselt.pdf'), PASSWORDS.user);
    expect(user).toMatchObject({ encrypted: true, ownerAccess: false });
    expect(user.permissions).toMatchObject({ printing: 'high', copying: false, modifying: false });
    expect(engine.security(read('verschluesselt.pdf'), PASSWORDS.owner).ownerAccess).toBe(true);
    const restricted = engine.security(read('eingeschraenkt.pdf'), null);
    expect(restricted).toMatchObject({ encrypted: true, ownerAccess: false });
    expect(restricted.permissions.printing).toBe('none');
  });

  it('setzt Kennwort zum Öffnen und Berechtigungen mit AES-256', async () => {
    const settings: SecuritySettings = {
      openPassword: 'oeffnen',
      permissionsPassword: 'rechte',
      permissions: { ...ALL_PERMISSIONS, printing: 'low', copying: false, modifying: false },
    };
    const output = await protect(read('text.pdf'), null, settings);
    expect(Buffer.from(output).toString('latin1')).toMatch(/\/V\s+5/);
    await expect(pdfjsOpen(output)).rejects.toThrow();
    const opened = await pdfjsOpen(output, 'oeffnen');
    expect(opened.text).toContain('Testdokument');
    const user = engine.security(output, 'oeffnen');
    expect(user).toMatchObject({ encrypted: true, ownerAccess: false });
    expect(user.permissions).toMatchObject({ printing: 'low', copying: false, modifying: false, annotating: true });
    expect(engine.security(output, 'rechte').ownerAccess).toBe(true);
    expect(engine.canOpen(output, null)).toBe(false);
    qpdfCheck(output, 'oeffnen');
  });

  it('nur Berechtigungen: öffnet ohne Kennwort, aber eingeschränkt', async () => {
    const output = await protect(read('text.pdf'), null, {
      openPassword: null,
      permissionsPassword: 'rechte',
      permissions: { ...ALL_PERMISSIONS, printing: 'none' },
    });
    const opened = await pdfjsOpen(output);
    expect(opened.permissions).not.toBeNull();
    expect(engine.security(output, null)).toMatchObject({ encrypted: true, ownerAccess: false });
    expect(engine.security(output, null).permissions.printing).toBe('none');
  });

  it('entfernt den Schutz mit dem Berechtigungskennwort', async () => {
    const output = await protect(read('verschluesselt.pdf'), PASSWORDS.owner, null);
    expect(engine.security(output, null)).toMatchObject({ encrypted: false, ownerAccess: true });
    expect((await pdfjsOpen(output)).text).toContain('Testdokument');
    qpdfCheck(output, '');
  });

  it('Kommentare in einem neu geschützten Dokument werden verschlüsselt gespeichert', async () => {
    const output = await protect(read('text.pdf'), null, { openPassword: 'oeffnen', permissionsPassword: null, permissions: ALL_PERMISSIONS });
    const annotation: ShapeAnnotation = {
      id: 'a1',
      ref: null,
      kind: 'square',
      fill: null,
      created: '2026-10-14T10:00:00.000Z',
      statuses: [],
      pageIndex: 0,
      rect: [100, 100, 200, 200],
      color: { r: 1, g: 0, b: 0 },
      opacity: 1,
      width: 2,
      contents: 'GEHEIMER-KOMMENTAR',
      author: 'Test',
      modified: '2026-10-14T10:00:00.000Z',
      replies: [],
    };
    const commented = engine.process(output, 'oeffnen', { upserts: [{ annotation, appearance: true }], deletions: [] }, [], { incremental: true });
    expect(Buffer.from(commented).toString('latin1')).not.toContain('GEHEIMER-KOMMENTAR');
    const task = pdfjs.getDocument({ data: commented.slice(), password: 'oeffnen', verbosity: 0 });
    const page = await (await task.promise).getPage(1);
    expect((await page.getAnnotations()).some((a) => a.contentsObj?.str === 'GEHEIMER-KOMMENTAR')).toBe(true);
    await task.destroy();
  });

  it('prüft die Eingaben im Dialog', () => {
    const base = { open: true, openPassword: 'a', openRepeat: 'a', restrict: false, permissionsPassword: '', permissionsRepeat: '' };
    expect(checkSecurityInput(base)).toBeNull();
    expect(checkSecurityInput({ ...base, openRepeat: 'b' })).toBe('open-mismatch');
    expect(checkSecurityInput({ ...base, openPassword: '', openRepeat: '' })).toBe('missing-password');
    expect(checkSecurityInput({ ...base, restrict: true, permissionsPassword: 'a', permissionsRepeat: 'a' })).toBe('same-passwords');
    expect(checkSecurityInput({ ...base, restrict: true, permissionsPassword: 'b', permissionsRepeat: 'c' })).toBe('permissions-mismatch');
    expect(checkSecurityInput({ ...base, openPassword: 'öffnen', openRepeat: 'öffnen' })).toBe('characters');
  });
});
