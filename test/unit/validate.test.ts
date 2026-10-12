import { describe, expect, it } from 'vitest';
import { MAX_READ_CHUNK } from '../../src/shared/ipc';
import {
  isAllowedExternalUrl,
  isFileId,
  looksLikePdf,
  validateMenuState,
  validateReadRange,
} from '../../src/shared/validate';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('looksLikePdf', () => {
  it('erkennt den PDF-Kopf am Anfang', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\n...'))).toBe(true);
  });
  it('erkennt den PDF-Kopf nach Müll in den ersten 1024 Bytes', () => {
    expect(looksLikePdf(bytes(`${'x'.repeat(500)}%PDF-1.4`))).toBe(true);
  });
  it('lehnt Text ohne Kopf ab', () => {
    expect(looksLikePdf(bytes('Das ist kein PDF'))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
  it('sucht nicht weiter als 1024 Bytes', () => {
    expect(looksLikePdf(bytes(`${'x'.repeat(1100)}%PDF-1.4`))).toBe(false);
  });
});

describe('validateReadRange', () => {
  it('akzeptiert gültige Bereiche und kürzt auf die Dateigröße', () => {
    expect(validateReadRange(0, 100, 50)).toEqual({ begin: 0, end: 50 });
    expect(validateReadRange(10, 20, 100)).toEqual({ begin: 10, end: 20 });
  });
  it('lehnt negative, ungeordnete und nicht ganzzahlige Werte ab', () => {
    expect(validateReadRange(-1, 10, 100)).toBeNull();
    expect(validateReadRange(20, 10, 100)).toBeNull();
    expect(validateReadRange(1.5, 10, 100)).toBeNull();
    expect(validateReadRange('0', 10, 100)).toBeNull();
    expect(validateReadRange(200, 300, 100)).toBeNull();
  });
  it('lehnt zu große Einzelzugriffe ab', () => {
    expect(validateReadRange(0, MAX_READ_CHUNK + 1, MAX_READ_CHUNK * 2)).toBeNull();
    expect(validateReadRange(0, MAX_READ_CHUNK, MAX_READ_CHUNK * 2)).not.toBeNull();
  });
});

describe('isAllowedExternalUrl', () => {
  it('erlaubt nur http, https und mailto', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com/a?b=c')).toBe(true);
    expect(isAllowedExternalUrl('mailto:info@example.com')).toBe(true);
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('smb://server/share')).toBe(false);
    expect(isAllowedExternalUrl('kein link')).toBe(false);
    expect(isAllowedExternalUrl(42)).toBe(false);
  });
});

describe('isFileId', () => {
  it('erkennt UUIDs', () => {
    expect(isFileId('3f2b8c1e-1234-4abc-9def-0123456789ab')).toBe(true);
    expect(isFileId('../../etc/passwd')).toBe(false);
  });
});

describe('validateMenuState', () => {
  const valid = {
    hasDocument: true,
    canPrint: false,
    viewMode: 'two-page',
    sidebarVisible: true,
    rightPanelVisible: false,
    tabCount: 2,
  };
  it('übernimmt einen gültigen Zustand', () => {
    expect(validateMenuState(valid)).toEqual(valid);
    expect(validateMenuState({ ...valid, viewMode: null })).not.toBeNull();
  });
  it('lehnt ungültige Werte ab', () => {
    expect(validateMenuState({ ...valid, viewMode: 'quer' })).toBeNull();
    expect(validateMenuState({ ...valid, tabCount: -1 })).toBeNull();
    expect(validateMenuState({ ...valid, hasDocument: 'ja' })).toBeNull();
    expect(validateMenuState(null)).toBeNull();
  });
});
