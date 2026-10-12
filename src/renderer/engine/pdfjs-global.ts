// Die Anzeige-Bausteine von pdf.js (pdf_viewer.mjs) erwarten die Bibliothek als globalThis.pdfjsLib.
// Dieses Modul muss vor pdf_viewer.mjs ausgewertet werden (siehe pdfjs-viewer.ts).
import { pdfjs } from './pdfjs';

(globalThis as unknown as { pdfjsLib: typeof pdfjs }).pdfjsLib = pdfjs;
