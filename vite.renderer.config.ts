import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

// Renderer (React-Oberfläche). Wird über app://bundle/ geladen, daher relative Pfade.
export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  publicDir: path.resolve(import.meta.dirname, 'src/renderer/public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'out/renderer'),
    emptyOutDir: true,
    target: 'chrome152',
    sourcemap: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
