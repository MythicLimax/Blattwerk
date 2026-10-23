import { describe, expect, it } from 'vitest';
import { systemFontFor, type SystemFont } from '../../src/shared/fonts';

const fonts: SystemFont[] = [
  { id: 'calibri', name: 'Calibri', styles: ['regular', 'bold', 'italic', 'boldItalic'] },
  { id: 'times-new-roman', name: 'Times New Roman', styles: ['regular', 'bold'] },
  { id: 'arial', name: 'Arial', styles: ['regular', 'bold', 'italic', 'boldItalic'] },
  { id: 'arial-narrow', name: 'Arial Narrow', styles: ['regular'] },
];

describe('Schrift des Rechners zu einem Schriftnamen aus einer PDF', () => {
  it('erkennt Familie und Schnitt in den üblichen Schreibweisen', () => {
    expect(systemFontFor('Calibri', fonts)).toBe('sys:calibri:regular');
    expect(systemFontFor('Calibri,Bold', fonts)).toBe('sys:calibri:bold');
    expect(systemFontFor('ABCDEF+Calibri-BoldItalic', fonts)).toBe('sys:calibri:boldItalic');
    expect(systemFontFor('TimesNewRomanPSMT', fonts)).toBe('sys:times-new-roman:regular');
    expect(systemFontFor('TimesNewRomanPS-BoldMT', fonts)).toBe('sys:times-new-roman:bold');
    expect(systemFontFor('Arial-ItalicMT', fonts)).toBe('sys:arial:italic');
    expect(systemFontFor('ArialNarrow', fonts)).toBe('sys:arial-narrow:regular');
    expect(systemFontFor('CalibriBold', fonts)).toBe('sys:calibri:bold');
  });

  it('nimmt den nächstliegenden vorhandenen Schnitt oder nichts', () => {
    expect(systemFontFor('TimesNewRomanPS-BoldItalicMT', fonts)).toBe('sys:times-new-roman:bold');
    expect(systemFontFor('TimesNewRomanPS-ItalicMT', fonts)).toBe('sys:times-new-roman:regular');
    expect(systemFontFor('Garamond', fonts)).toBeNull();
  });
});
