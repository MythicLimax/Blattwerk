// Baut die native Mac-Erweiterung für Apples Liquid Glass (native/macos-glass, ADR 0023) nach out/native/.
// Nur unter macOS; ohne Xcode-Werkzeuge wird sie übersprungen (die App nutzt dann das CSS-Glas).
// Node-API ist über Node- und Electron-Versionen stabil, deshalb genügen die Header des Node-Werkzeugs.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildNative() {
  if (process.platform !== 'darwin') return false;
  const include = path.join(path.dirname(process.execPath), '..', 'include', 'node');
  if (!existsSync(path.join(include, 'node_api.h'))) {
    console.warn('Native Erweiterung übersprungen: Node-Header fehlen');
    return false;
  }
  const outDir = path.join(root, 'out', 'native');
  mkdirSync(outDir, { recursive: true });
  try {
    execFileSync(
      'clang++',
      [
        '-ObjC++',
        '-fobjc-arc',
        '-std=c++17',
        '-O2',
        '-shared',
        '-undefined',
        'dynamic_lookup',
        '-mmacosx-version-min=12.0',
        '-arch',
        'arm64',
        '-arch',
        'x86_64',
        '-DNODE_GYP_MODULE_NAME=macos_glass',
        '-I',
        include,
        '-framework',
        'AppKit',
        '-framework',
        'QuartzCore',
        path.join(root, 'native', 'macos-glass', 'glass.mm'),
        '-o',
        path.join(outDir, 'macos-glass.node'),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
    return true;
  } catch (error) {
    console.warn('Native Erweiterung übersprungen:', error instanceof Error ? error.message : error);
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildNative();
