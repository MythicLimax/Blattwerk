// Reihenfolge wichtig: erst die globale Bibliothek setzen, dann die Anzeige-Bausteine laden.
import './pdfjs-global';

export {
  EventBus,
  FindState,
  GenericL10n,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
