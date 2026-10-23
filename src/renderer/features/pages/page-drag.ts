// Seiten zwischen Dokumenten ziehen (Seitenraster). Das Quellfenster vergibt beim Ziehen eine Kennung; das Ziel holt
// die Seiten damit ab, im selben Fenster direkt, sonst über den Hauptprozess beim Quellfenster (IPC pages:fetch).
// Übernommen wird eine Kopie samt ungespeicherter Änderungen, wie beim Ziehen zwischen Dokumenten in Acrobat.
import type { ComposePart } from '../../../shared/pages';
import { api } from '../../api';
import { composeDocument } from '../../engine/pdfium-client';
import { useDocuments } from '../../state/documents-store';
import type { SourceFile } from '../../state/ui-store';
import { currentBytes } from './actions';

// Daten des Ziehens zwischen Dokumenten (eigener Typ neben dem für das Umsortieren im selben Raster)
export const PAGE_TRANSFER_TYPE = 'application/x-blattwerk-page-transfer';

export interface PageTransfer {
  token: string;
  count: number;
  name: string;
}

const offered = new Map<string, { tabId: string; pages: number[] }>();

// Seiten zum Ziehen anbieten; die Kennung gilt bis zum nächsten Ziehen aus diesem Fenster
export function offerPages(tabId: string, pages: number[]): string {
  offered.clear();
  const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  offered.set(token, { tabId, pages: [...pages] });
  return token;
}

async function pagesAsPdf(tabId: string, pages: number[]): Promise<Uint8Array | null> {
  const tab = useDocuments.getState().tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.status !== 'ready') return null;
  const { bytes, password } = await currentBytes(tab);
  const part: ComposePart = { type: 'pdf', source: { data: bytes.slice().buffer as ArrayBuffer, password, pages } };
  return composeDocument([part]);
}

// Anfragen anderer Fenster beantworten (einmal beim Start der Oberfläche)
export function startPageProvider(): () => void {
  return api.onProvidePages(({ requestId, token }) => {
    const entry = offered.get(token);
    if (!entry) return;
    void pagesAsPdf(entry.tabId, entry.pages)
      .catch(() => null)
      .then((bytes) => api.providePages(requestId, bytes));
  });
}

// Gezogene Seiten als Quelle zum Einfügen (null: Quelle nicht mehr verfügbar)
export async function draggedPages(transfer: PageTransfer): Promise<SourceFile | null> {
  const local = offered.get(transfer.token);
  const bytes = local ? await pagesAsPdf(local.tabId, local.pages) : await api.fetchDraggedPages(transfer.token);
  if (!bytes) return null;
  return { name: transfer.name, kind: 'pdf', bytes, password: null, pageCount: transfer.count, image: null };
}

export function parsePageTransfer(text: string): PageTransfer | null {
  try {
    const value = JSON.parse(text) as Partial<PageTransfer>;
    return typeof value.token === 'string' && typeof value.count === 'number' && typeof value.name === 'string' ? (value as PageTransfer) : null;
  } catch {
    return null;
  }
}
