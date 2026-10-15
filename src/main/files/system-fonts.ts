// Beliebte Schriften des Rechners zum Schreiben im Modus „Text und Bilder bearbeiten“ (ADR 0024). Gesucht wird in den
// Schriftordnern von macOS, den Schriften von Microsoft Office (Word bringt Aptos, Calibri u. a. mit) und unter Windows
// im Systemordner. Angeboten wird nur, was die Lizenz der Schrift einbetten lässt (OS/2 fsType); die App liefert
// selbst keine Schriften aus. Der Renderer kennt nur Kennungen (z. B. „sys:arial:bold“), nie Pfade.
import { app } from 'electron';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { embeddingAllowed, type SystemFont, type SystemFontStyle } from '../../shared/fonts';

type Files = Partial<Record<SystemFontStyle, string[]>>;

interface Family {
  id: string;
  name: string;
  files: Files;
}

// Dateinamen je Schnitt; macOS-Namen zuerst, dann Windows-Namen
const FAMILIES: Family[] = [
  { id: 'aptos', name: 'Aptos', files: { regular: ['Aptos.ttf'], bold: ['Aptos-Bold.ttf'], italic: ['Aptos-Italic.ttf'], boldItalic: ['Aptos-Bold-Italic.ttf'] } },
  { id: 'arial', name: 'Arial', files: { regular: ['Arial.ttf', 'arial.ttf'], bold: ['Arial Bold.ttf', 'arialbd.ttf'], italic: ['Arial Italic.ttf', 'ariali.ttf'], boldItalic: ['Arial Bold Italic.ttf', 'arialbi.ttf'] } },
  { id: 'calibri', name: 'Calibri', files: { regular: ['Calibri.ttf', 'calibri.ttf'], bold: ['Calibrib.ttf', 'calibrib.ttf'], italic: ['Calibrii.ttf', 'calibrii.ttf'], boldItalic: ['Calibriz.ttf', 'calibriz.ttf'] } },
  { id: 'times-new-roman', name: 'Times New Roman', files: { regular: ['Times New Roman.ttf', 'times.ttf'], bold: ['Times New Roman Bold.ttf', 'timesbd.ttf'], italic: ['Times New Roman Italic.ttf', 'timesi.ttf'], boldItalic: ['Times New Roman Bold Italic.ttf', 'timesbi.ttf'] } },
  { id: 'georgia', name: 'Georgia', files: { regular: ['Georgia.ttf', 'georgia.ttf'], bold: ['Georgia Bold.ttf', 'georgiab.ttf'], italic: ['Georgia Italic.ttf', 'georgiai.ttf'], boldItalic: ['Georgia Bold Italic.ttf', 'georgiaz.ttf'] } },
  { id: 'garamond', name: 'Garamond', files: { regular: ['GARA.ttf', 'GARA.TTF'], bold: ['GARABD.ttf', 'GARABD.TTF'], italic: ['GARAIT.ttf', 'GARAIT.TTF'] } },
  { id: 'cambria', name: 'Cambria', files: { bold: ['Cambriab.ttf', 'cambriab.ttf'], italic: ['Cambriai.ttf', 'cambriai.ttf'], boldItalic: ['Cambriaz.ttf', 'cambriaz.ttf'] } },
  { id: 'constantia', name: 'Constantia', files: { regular: ['Constan.ttf', 'constan.ttf'], bold: ['Constanb.ttf', 'constanb.ttf'], italic: ['Constani.ttf', 'constani.ttf'], boldItalic: ['Constanz.ttf', 'constanz.ttf'] } },
  { id: 'book-antiqua', name: 'Book Antiqua', files: { regular: ['Book Antiqua.ttf', 'BKANT.TTF'], bold: ['Book Antiqua Bold.ttf', 'ANTQUAB.TTF'], italic: ['Book Antiqua Italic.ttf', 'ANTQUAI.TTF'], boldItalic: ['Book Antiqua Bold Italic.ttf', 'ANTQUABI.TTF'] } },
  { id: 'verdana', name: 'Verdana', files: { regular: ['Verdana.ttf', 'verdana.ttf'], bold: ['Verdana Bold.ttf', 'verdanab.ttf'], italic: ['Verdana Italic.ttf', 'verdanai.ttf'], boldItalic: ['Verdana Bold Italic.ttf', 'verdanaz.ttf'] } },
  { id: 'tahoma', name: 'Tahoma', files: { regular: ['Tahoma.ttf', 'tahoma.ttf'], bold: ['Tahoma Bold.ttf', 'tahomabd.ttf'] } },
  { id: 'trebuchet', name: 'Trebuchet MS', files: { regular: ['Trebuchet MS.ttf', 'trebuc.ttf'], bold: ['Trebuchet MS Bold.ttf', 'trebucbd.ttf'], italic: ['Trebuchet MS Italic.ttf', 'trebucit.ttf'], boldItalic: ['Trebuchet MS Bold Italic.ttf', 'trebucbi.ttf'] } },
  { id: 'century-gothic', name: 'Century Gothic', files: { regular: ['Century Gothic.ttf', 'GOTHIC.TTF'], bold: ['Century Gothic Bold.ttf', 'GOTHICB.TTF'], italic: ['Century Gothic Italic.ttf', 'GOTHICI.TTF'], boldItalic: ['Century Gothic Bold Italic.ttf', 'GOTHICBI.TTF'] } },
  { id: 'gill-sans', name: 'Gill Sans MT', files: { regular: ['Gill Sans MT.ttf', 'GIL_____.TTF'], bold: ['Gill Sans MT Bold.ttf', 'GILB____.TTF'], italic: ['Gill Sans MT Italic.ttf', 'GILI____.TTF'], boldItalic: ['Gill Sans MT Bold Italic.ttf', 'GILBI___.TTF'] } },
  { id: 'franklin-gothic', name: 'Franklin Gothic Book', files: { regular: ['Franklin Gothic Book.ttf', 'FRABK.TTF'], italic: ['Franklin Gothic Book Italic.ttf', 'FRABKIT.TTF'] } },
  { id: 'candara', name: 'Candara', files: { regular: ['Candara.ttf', 'Candara.ttf'], bold: ['Candarab.ttf'], italic: ['Candarai.ttf'], boldItalic: ['Candaraz.ttf'] } },
  { id: 'corbel', name: 'Corbel', files: { regular: ['Corbel.ttf', 'corbel.ttf'], bold: ['Corbelb.ttf', 'corbelb.ttf'], italic: ['Corbeli.ttf', 'corbeli.ttf'], boldItalic: ['Corbelz.ttf', 'corbelz.ttf'] } },
  { id: 'comic-sans', name: 'Comic Sans MS', files: { regular: ['Comic Sans MS.ttf', 'comic.ttf'], bold: ['Comic Sans MS Bold.ttf', 'comicbd.ttf'] } },
  { id: 'courier-new', name: 'Courier New', files: { regular: ['Courier New.ttf', 'cour.ttf'], bold: ['Courier New Bold.ttf', 'courbd.ttf'], italic: ['Courier New Italic.ttf', 'couri.ttf'], boldItalic: ['Courier New Bold Italic.ttf', 'courbi.ttf'] } },
  { id: 'consolas', name: 'Consolas', files: { regular: ['Consola.ttf', 'consola.ttf'], bold: ['Consolab.ttf', 'consolab.ttf'], italic: ['Consolai.ttf', 'consolai.ttf'], boldItalic: ['Consolaz.ttf', 'consolaz.ttf'] } },
];

const MAX_FONT_BYTES = 40 * 1024 * 1024;

function fontDirs(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts/Supplemental',
      '/Library/Fonts',
      path.join(app.getPath('home'), 'Library', 'Fonts'),
      // Schriften, die Microsoft Office mitbringt (nicht im System angemeldet)
      '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
      '/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts',
      '/Applications/Microsoft Excel.app/Contents/Resources/DFonts',
    ];
  }
  if (process.platform === 'win32') {
    const windows = process.env.WINDIR ?? 'C:\\Windows';
    return [path.join(windows, 'Fonts'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'Windows', 'Fonts')];
  }
  return ['/usr/share/fonts/truetype/msttcorefonts', path.join(app.getPath('home'), '.fonts')];
}

// Nur der Kopf der Datei: Tabellenverzeichnis und, falls vorhanden, der Anfang der OS/2-Tabelle (an ihrer Stelle)
function fontHeader(file: string): Uint8Array {
  const fd = openSync(file, 'r');
  try {
    const directory = Buffer.alloc(12 + 64 * 16);
    const read = readSync(fd, directory, 0, directory.length, 0);
    const view = new DataView(directory.buffer, directory.byteOffset, read);
    const tables = read >= 12 ? Math.min(64, view.getUint16(4)) : 0;
    for (let i = 0; i < tables && 12 + i * 16 + 16 <= read; i++) {
      const record = 12 + i * 16;
      if (directory.toString('latin1', record, record + 4) !== 'OS/2') continue;
      const offset = view.getUint32(record + 8);
      // Verzeichnis plus OS/2-Anfang zusammensetzen: OS/2 wird an Stelle 12 + Tabellen·16 umgehängt
      const os2 = Buffer.alloc(16);
      readSync(fd, os2, 0, 16, offset);
      const header = Buffer.concat([directory.subarray(0, 12 + tables * 16), os2]);
      new DataView(header.buffer, header.byteOffset).setUint32(record + 8, 12 + tables * 16);
      return new Uint8Array(header);
    }
    return new Uint8Array(directory.subarray(0, read));
  } finally {
    closeSync(fd);
  }
}

interface Found {
  font: SystemFont;
  paths: Partial<Record<SystemFontStyle, string>>;
}

let catalog: Found[] | null = null;

function findFile(candidates: string[], dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of candidates) {
      const file = path.join(dir, name);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

function loadCatalog(): Found[] {
  if (catalog) return catalog;
  const dirs = fontDirs().filter((dir) => existsSync(dir));
  catalog = [];
  for (const family of FAMILIES) {
    const paths: Partial<Record<SystemFontStyle, string>> = {};
    for (const [style, candidates] of Object.entries(family.files) as Array<[SystemFontStyle, string[]]>) {
      const file = findFile(candidates, dirs);
      if (!file) continue;
      try {
        if (statSync(file).size <= MAX_FONT_BYTES && embeddingAllowed(fontHeader(file))) paths[style] = file;
      } catch {
        // nicht lesbar: auslassen
      }
    }
    const styles = (['regular', 'bold', 'italic', 'boldItalic'] as const).filter((style) => paths[style]);
    if (styles.length > 0) catalog.push({ font: { id: family.id, name: family.name, styles }, paths });
  }
  return catalog;
}

export function listSystemFonts(): SystemFont[] {
  return loadCatalog().map((entry) => entry.font);
}

export function readSystemFont(id: string, style: SystemFontStyle): Uint8Array | null {
  const file = loadCatalog().find((entry) => entry.font.id === id)?.paths[style];
  if (!file) return null;
  try {
    return new Uint8Array(readFileSync(file));
  } catch {
    return null;
  }
}
