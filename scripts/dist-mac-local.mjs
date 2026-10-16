// Baut die Mac-App (Apple Silicon) außerhalb des Projektordners und kopiert nur die fertige .dmg nach release/.
// Grund: Liegt das Projekt in einem iCloud-Ordner, versieht iCloud die Dateien mit Attributen, an denen
// die Signatur scheitert. Im temporären Ordner passiert das nicht.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(tmpdir(), 'blattwerk-release');
rmSync(outDir, { recursive: true, force: true });

execFileSync(
  process.execPath,
  [path.join(root, 'node_modules', 'electron-builder', 'cli.js'), '--mac', '--arm64', `--config.directories.output=${outDir}`],
  { cwd: root, stdio: 'inherit' },
);

const releaseDir = path.join(root, 'release');
mkdirSync(releaseDir, { recursive: true });
for (const name of readdirSync(outDir).filter((n) => n.endsWith('.dmg'))) {
  cpSync(path.join(outDir, name), path.join(releaseDir, name));
  console.log(`release/${name}`);
}
const bundle = path.join(outDir, 'mac-arm64', 'Blattwerk.app');
console.log(`App-Bundle: ${bundle}`);

// Update bereitlegen (ADR 0025): Die installierte App findet die neue Version im Ordner „Updates“ ihres Profils und
// bietet „Jetzt aktualisieren“ an. Erst vollständig kopieren, dann umbenennen (nie eine halbe App im Ordner).
if (process.platform === 'darwin' && !process.argv.includes('--no-update')) {
  const updates = path.join(homedir(), 'Library', 'Application Support', 'Blattwerk', 'Updates');
  mkdirSync(updates, { recursive: true });
  const staging = path.join(updates, '.Blattwerk.app.neu');
  const target = path.join(updates, 'Blattwerk.app');
  rmSync(staging, { recursive: true, force: true });
  execFileSync('/usr/bin/ditto', [bundle, staging]);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);
  console.log(`Update bereitgelegt: ${target}`);
}
