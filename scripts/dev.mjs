// Entwicklungsmodus: Vite-Server für den Renderer, Hauptprozess und Preload im Watch-Modus,
// Electron startet bei Änderungen am Hauptprozess neu.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { mainConfig, preloadConfig } from './build.mjs';
import { copyPdfjsAssets } from './copy-pdfjs-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBinary = (await import('electron')).default;

await copyPdfjsAssets();
const server = await createServer({ configFile: path.join(root, 'vite.renderer.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

let child = null;
let restarting = false;
function startElectron() {
  child = spawn(electronBinary, ['.', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    // Eigenes Profil: trennt Einstellungen, Zuletzt-Liste und Einzelinstanz-Sperre von der installierten App.
    env: {
      ...process.env,
      BLATTWERK_DEV_SERVER_URL: url,
      BLATTWERK_USER_DATA: process.env.BLATTWERK_USER_DATA ?? path.join(root, '.tools', 'dev-profile'),
    },
  });
  child.on('exit', () => {
    if (!restarting) {
      void server.close();
      process.exit(0);
    }
  });
}

function restart() {
  if (!child) return startElectron();
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    startElectron();
  });
  child.kill();
}

let ready = 0;
const onBuilt = (watcher) =>
  watcher.on('event', (event) => {
    if (event.code === 'END') {
      ready++;
      if (ready >= 2) restart();
    }
  });
onBuilt(await build(preloadConfig(true)));
onBuilt(await build(mainConfig(true)));
