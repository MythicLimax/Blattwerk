// Barrierefreiheit (Phase 7): Tags auslesen, prüfen, einfache Mängel beheben.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AccessibilityReport } from '../../src/shared/accessibility';
import { checkAccessibility, fixAccessibility } from '../../src/workers/pdfium/accessibility';
import { fixture } from '../fixtures/expectations';
import { taggedPdf } from '../fixtures/tagged';

const status = (report: AccessibilityReport) => Object.fromEntries(report.checks.map((check) => [check.code, check.count ? `${check.status}:${check.count}` : check.status]));

describe('Barrierefreiheit', () => {
  it('liest die Tag-Struktur mit Rollen, Alternativtexten und Seiten', async () => {
    const report = await checkAccessibility(await taggedPdf());
    expect(report.tagged).toBe(true);
    expect(report.truncated).toBe(false);
    const [document] = report.tree;
    expect(document?.role).toBe('Document');
    expect(document?.children.map((node) => node.role)).toEqual(['H1', 'P', 'H3', 'Figure', 'Figure', 'Table']);
    expect(document?.children[0]).toMatchObject({ role: 'H1', customRole: 'Ueberschrift', pageIndex: 0, contents: 1 });
    expect(document?.children[4]?.alt).toBe('Diagramm der Umsätze');
  });

  it('meldet Mängel getaggter Dokumente', async () => {
    const report = await checkAccessibility(await taggedPdf());
    expect(status(report)).toEqual({
      tagged: 'passed',
      language: 'failed',
      title: 'failed',
      'display-title': 'failed',
      'tab-order': 'failed:1',
      'figure-alt': 'failed:1',
      'heading-order': 'failed:1',
      'table-headers': 'failed:1',
      'annotations-tagged': 'failed:1',
      'field-tooltip': 'passed',
      'image-only': 'passed',
      bookmarks: 'passed',
    });
  });

  it('erkennt fehlende Tags und reine Bildseiten', async () => {
    const text = status(await checkAccessibility(new Uint8Array(readFileSync(fixture('text.pdf')))));
    expect(text.tagged).toBe('failed');
    expect(text['figure-alt']).toBe('skipped');
    const scan = status(await checkAccessibility(new Uint8Array(readFileSync(fixture('scan.pdf')))));
    expect(scan['image-only']).toMatch(/^failed:/);
  });

  it('setzt Sprache, Titel, Titelanzeige und Tab-Reihenfolge', async () => {
    const original = await taggedPdf();
    const fixed = await fixAccessibility(original, { lang: 'de-DE', title: 'Jahresbericht' });
    expect(Buffer.from(fixed.subarray(0, original.length)).equals(Buffer.from(original))).toBe(true);
    const report = await checkAccessibility(fixed);
    expect(report.lang).toBe('de-DE');
    expect(report.title).toBe('Jahresbericht');
    const result = status(report);
    expect(result.language).toBe('passed');
    expect(result.title).toBe('passed');
    expect(result['display-title']).toBe('passed');
    expect(result['tab-order']).toBe('passed');
  });

  it('prüft Formularfelder auf QuickInfo', async () => {
    const report = await checkAccessibility(new Uint8Array(readFileSync(fixture('formular.pdf'))));
    expect(report.checks.find((check) => check.code === 'field-tooltip')?.status).toBeDefined();
  });
});
