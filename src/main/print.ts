import { type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PrintRequest, PrintResult } from '../shared/ipc';

// Druckt den vom Renderer vorbereiteten Druckbereich (gerenderte Seitenbilder, @media print).
// Im Testmodus (BLATTWERK_E2E_PRINT_DIR) entsteht statt des Systemdialogs eine PDF-Datei,
// damit automatische Tests den Druckweg prüfen können.
export async function printWindow(win: BrowserWindow, request: PrintRequest): Promise<PrintResult> {
  const e2eDir = process.env.BLATTWERK_E2E_PRINT_DIR;
  if (e2eDir) {
    try {
      const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: false });
      const safeName = request.documentName.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'druck';
      await fs.mkdir(e2eDir, { recursive: true });
      await fs.writeFile(path.join(e2eDir, `${safeName}.print.pdf`), data);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: 'failed', detail: String(error) };
    }
  }

  return new Promise<PrintResult>((resolve) => {
    win.webContents.print({ silent: false, printBackground: false }, (success, failureReason) => {
      if (success) {
        resolve({ ok: true });
      } else if (/cancel/i.test(failureReason)) {
        resolve({ ok: false, reason: 'cancelled' });
      } else {
        resolve({ ok: false, reason: 'failed', detail: failureReason });
      }
    });
  });
}
