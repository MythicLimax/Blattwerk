// Kopiert die Laufzeit-Ressourcen von pdf.js (CMaps, Standardschriften, WASM-Decoder, Farbprofile,
// Symbolbilder) und die deutschen Texte der pdf.js-Anzeigebausteine in den public-Ordner des Renderers. Dazu die
// Texterkennung (tesseract.js: Worker, WASM-Kern, Sprachdaten Deutsch und Englisch), damit sie ohne Netz läuft.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist');
const publicDir = path.join(root, 'src', 'renderer', 'public');

export async function copyPdfjsAssets() {
  await rm(path.join(publicDir, 'pdfjs'), { recursive: true, force: true });
  await rm(path.join(publicDir, 'pdfjs-l10n'), { recursive: true, force: true });
  for (const [from, to] of [
    ['cmaps', 'cmaps'],
    ['standard_fonts', 'standard_fonts'],
    ['wasm', 'wasm'],
    ['iccs', 'iccs'],
    ['web/images', 'images'],
  ]) {
    // Ohne die Liberation-Schriften (GPL mit Schriftausnahme): pdf.js lädt sie nur bei useSystemFonts: false,
    // die App nutzt die Systemschriften. Gebraucht werden nur Symbol und Dingbats (Foxit, BSD).
    await cp(path.join(pdfjsDir, from), path.join(publicDir, 'pdfjs', to), { recursive: true, filter: (file) => !/Liberation/i.test(path.basename(file)) });
  }
  const l10nDir = path.join(publicDir, 'pdfjs-l10n');
  await mkdir(l10nDir, { recursive: true });
  await cp(path.join(root, 'src', 'locales', 'de', 'pdfjs-viewer.ftl'), path.join(l10nDir, 'de.ftl'));
  await writeFile(path.join(l10nDir, 'locale.json'), JSON.stringify({ de: 'de.ftl' }, null, 2));
  await copyOcrAssets();
}

// Texterkennung: nur der LSTM-Kern (mit und ohne SIMD) und die beiden Sprachen
async function copyOcrAssets() {
  const ocrDir = path.join(publicDir, 'ocr');
  await rm(ocrDir, { recursive: true, force: true });
  await mkdir(path.join(ocrDir, 'core'), { recursive: true });
  await mkdir(path.join(ocrDir, 'lang'), { recursive: true });
  await cp(path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), path.join(ocrDir, 'worker.min.js'));
  for (const variant of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
    const file = `tesseract-core-${variant}.wasm.js`;
    await cp(path.join(root, 'node_modules', 'tesseract.js-core', file), path.join(ocrDir, 'core', file));
  }
  for (const lang of ['deu', 'eng']) {
    const file = `${lang}.traineddata.gz`;
    await cp(path.join(root, 'node_modules', '@tesseract.js-data', lang, '4.0.0_best_int', file), path.join(ocrDir, 'lang', file));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await copyPdfjsAssets();
  console.log('pdf.js-Ressourcen kopiert.');
}
