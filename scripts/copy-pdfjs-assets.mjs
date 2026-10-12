// Kopiert die Laufzeit-Ressourcen von pdf.js (CMaps, Standardschriften, WASM-Decoder, Farbprofile,
// Symbolbilder) und die deutschen Texte der pdf.js-Anzeigebausteine in den public-Ordner des Renderers.
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
    await cp(path.join(pdfjsDir, from), path.join(publicDir, 'pdfjs', to), { recursive: true });
  }
  const l10nDir = path.join(publicDir, 'pdfjs-l10n');
  await mkdir(l10nDir, { recursive: true });
  await cp(path.join(root, 'src', 'locales', 'de', 'pdfjs-viewer.ftl'), path.join(l10nDir, 'de.ftl'));
  await writeFile(path.join(l10nDir, 'locale.json'), JSON.stringify({ de: 'de.ftl' }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await copyPdfjsAssets();
  console.log('pdf.js-Ressourcen kopiert.');
}
