// Erwartete Eigenschaften der Test-PDFs (siehe scripts/generate-fixtures.ts).
import path from 'node:path';

export const FIXTURES_DIR = path.resolve(import.meta.dirname, 'pdfs');
export const GENERATED_DIR = path.resolve(import.meta.dirname, 'generated');

export const fixture = (name: string) => path.join(FIXTURES_DIR, name);
export const LARGE_PDF = path.join(GENERATED_DIR, 'gross-600-seiten.pdf');

export const TEXT_PDF = {
  file: 'text.pdf',
  title: 'Testdokument mit Text',
  author: 'Blattwerk-Testsuite',
  pages: 12,
  searchTerm: 'Suchprobe',
  searchHits: 6,
  searchPages: { 2: 2, 5: 1, 9: 3 } as Record<number, number>,
  outlineTop: ['Testdokument mit Text', 'Kapitel 1', 'Kapitel 2', 'Kapitel 3 – Übersicht'],
  outlineChildren: ['Abschnitt 1.1', 'Abschnitt 1.2'],
  outlineTargets: { 'Kapitel 2': 6, 'Kapitel 3 – Übersicht': 10, 'Abschnitt 1.2': 5 } as Record<string, number>,
  tocLinks: [3, 6, 10],
  externalUrl: 'https://example.com/',
};

export const PASSWORDS = { user: 'geheim', owner: 'besitzer' };
