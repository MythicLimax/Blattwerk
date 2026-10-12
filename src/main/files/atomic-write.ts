import { randomBytes } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

// Schreibt Daten so, dass die Zieldatei zu keinem Zeitpunkt halb geschrieben ist:
// temporäre Datei im selben Ordner, fsync, dann rename über das Ziel.
// Schlägt etwas fehl, bleibt die alte Datei unverändert und die temporäre Datei wird entfernt.

const WINDOWS_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface AtomicWriteOptions {
  // Für Tests: Wartezeiten zwischen Wiederholungen unter Windows
  retryDelaysMs?: number[];
  platform?: NodeJS.Platform;
}

export async function atomicWrite(
  targetPath: string,
  data: Uint8Array | string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tempPath = path.join(dir, `.${base}.${randomBytes(6).toString('hex')}.tmp`);
  const platform = options.platform ?? process.platform;

  let mode: number | undefined;
  try {
    mode = (await fs.stat(targetPath)).mode;
  } catch {
    mode = undefined;
  }

  const handle = await fs.open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode ?? 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true });
    throw error;
  }
  await handle.close();

  try {
    await renameWithRetry(tempPath, targetPath, platform, options.retryDelaysMs);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }

  // Ordnereintrag dauerhaft machen (unter Windows nicht möglich und nicht nötig)
  if (platform !== 'win32') {
    try {
      const dirHandle = await fs.open(dir, 'r');
      await dirHandle.sync().finally(() => dirHandle.close());
    } catch {
      // Manche Dateisysteme erlauben kein fsync auf Ordnern. Die Datei selbst ist bereits geschrieben.
    }
  }
}

async function renameWithRetry(
  from: string,
  to: string,
  platform: NodeJS.Platform,
  delays: number[] = [50, 100, 250, 500, 1000],
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const delay = delays[attempt];
      if (platform !== 'win32' || !code || !WINDOWS_RETRY_CODES.has(code) || delay === undefined) {
        throw error;
      }
      // Unter Windows halten Virenscanner oder Indexdienste Dateien kurz fest.
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
