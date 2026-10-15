// Baut Hauptprozess, Preload und Renderer nach out/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { buildNative } from './build-native.mjs';
import { copyPdfjsAssets } from './copy-pdfjs-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Hauptprozess und Preload laufen in Node bzw. der Preload-Sandbox. Alles außer Electron
// und Node-Modulen wird eingebündelt, damit die fertige App keine node_modules braucht.
function nodeConfig({ entry, outDir, format, fileName, watch }) {
  return {
    configFile: false,
    root,
    logLevel: 'warn',
    build: {
      ssr: entry,
      outDir,
      emptyOutDir: true,
      target: 'node24',
      sourcemap: true,
      minify: false,
      watch: watch ? {} : null,
      rolldownOptions: {
        external: ['electron', /^node:/],
        output: { format, entryFileNames: fileName },
      },
    },
    ssr: { noExternal: true, target: 'node' },
  };
}

export function mainConfig(watch = false) {
  return nodeConfig({ entry: 'src/main/index.ts', outDir: 'out/main', format: 'es', fileName: 'index.js', watch });
}

export function preloadConfig(watch = false) {
  return nodeConfig({ entry: 'src/preload/index.ts', outDir: 'out/preload', format: 'cjs', fileName: 'index.cjs', watch });
}

export async function buildAll() {
  await copyPdfjsAssets();
  await build(mainConfig());
  await build(preloadConfig());
  await build({ configFile: path.join(root, 'vite.renderer.config.ts'), logLevel: 'warn' });
  buildNative();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAll();
  console.log('Build fertig: out/');
}
