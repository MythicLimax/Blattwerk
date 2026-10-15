// Apples Liquid Glass unter macOS 26+ (ADR 0023): lädt die native Erweiterung (native/macos-glass) und setzt die
// Glasflächen, die der Renderer meldet. Fehlt die Erweiterung oder ist macOS zu alt, bleibt alles beim CSS-Glas.
import { app, type BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { GlassRegion } from '../shared/ipc';

interface GlassModule {
  supported(): boolean;
  attach(handle: Buffer): boolean;
  setRegions(handle: Buffer, regions: GlassRegion[]): boolean;
  detach(handle: Buffer): boolean;
  describe(handle: Buffer): Array<{ x: number; y: number; width: number; height: number; windowOpaque: boolean }>;
}

let loaded: GlassModule | null | undefined;

function glassModule(): GlassModule | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (process.platform !== 'darwin' || process.env.BLATTWERK_NO_NATIVE_GLASS === '1') return null;
  // Im Paket liegt die Erweiterung außerhalb des ASAR-Archivs (asarUnpack)
  const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked');
  const file = path.join(base, 'out', 'native', 'macos-glass.node');
  if (!existsSync(file)) return null;
  try {
    const module = { exports: {} as GlassModule };
    process.dlopen(module, file);
    loaded = module.exports.supported() ? module.exports : null;
  } catch (error) {
    console.error('Liquid Glass (nativ) nicht verfügbar', error);
  }
  return loaded;
}

// Macht das Fenster durchsichtig, damit das Glas darunter sichtbar wird. true, wenn natives Glas aktiv ist.
export function attachNativeGlass(win: BrowserWindow): boolean {
  const glass = glassModule();
  if (!glass) return false;
  const ok = glass.attach(win.getNativeWindowHandle());
  if (ok) win.setBackgroundColor('#00000000');
  return ok;
}

export function setNativeGlassRegions(win: BrowserWindow, regions: GlassRegion[]): void {
  const glass = glassModule();
  if (glass && !win.isDestroyed()) glass.setRegions(win.getNativeWindowHandle(), regions);
}

export function describeNativeGlass(win: BrowserWindow): ReturnType<GlassModule['describe']> {
  return glassModule()?.describe(win.getNativeWindowHandle()) ?? [];
}

export const nativeGlassAvailable = (): boolean => glassModule() !== null;
