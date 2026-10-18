// Prüft die Lizenzen aller Pakete, die in die fertige App eingebündelt werden (dependencies samt Unterabhängigkeiten).
// Erlaubt sind nur permissive Lizenzen (siehe CLAUDE.md). Bei Verstoß endet das Skript mit Fehlercode 1.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Zlib (pako) und BlueOak-1.0.0 (lru-cache, über @libpdf/core) sind ebenso freizügig; begründet in
// docs/entscheidungen/0016-digitale-signaturen.md.
const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Zlib', 'BlueOak-1.0.0']);

// Unter Windows ist npm ein Skript (npm.cmd), das sich nicht direkt starten lässt. Deshalb npm über Node aufrufen,
// wenn das Skript über `npm run` läuft (npm_execpath zeigt dann auf npm-cli.js).
const npmCli = process.env.npm_execpath;
const [command, prefix] = npmCli && npmCli.endsWith('.js') ? [process.execPath, [npmCli]] : ['npm', []];
const tree = JSON.parse(
  execFileSync(command, [...prefix, 'ls', '--omit=dev', '--all', '--json', '--long'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);

const seen = new Map();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (!dep.path || seen.has(dep.path)) continue;
    let license = dep.license;
    if (!license) {
      try {
        license = JSON.parse(readFileSync(path.join(dep.path, 'package.json'), 'utf8')).license;
      } catch {
        license = undefined;
      }
    }
    seen.set(dep.path, { name, version: dep.version, license: typeof license === 'object' ? license?.type : license });
    walk(dep);
  }
})(tree);

// "(MIT OR Apache-2.0)" ist erlaubt, wenn mindestens eine Alternative erlaubt ist; bei "MIT AND Zlib" müssen alle
// Teile erlaubt sein.
const isAllowed = (license) =>
  typeof license === 'string' &&
  license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((option) => option.split(/\s+AND\s+/).every((part) => ALLOWED.has(part.trim())));

const problems = [...seen.values()].filter((p) => !isAllowed(p.license));
for (const p of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${isAllowed(p.license) ? 'ok ' : 'NEIN'}  ${p.name}@${p.version}  ${p.license ?? '(keine Angabe)'}`);
}
if (problems.length > 0) {
  console.error(`\n${problems.length} Paket(e) mit nicht erlaubter Lizenz.`);
  process.exit(1);
}
console.log(`\nAlle ${seen.size} eingebündelten Pakete haben eine erlaubte Lizenz.`);
