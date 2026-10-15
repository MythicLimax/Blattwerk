// PDF/A (Phase 7): Dialog mit dem Prüfergebnis des aktiven Dokuments.
import { create } from 'zustand';
import type { PdfAReport } from '../../../shared/pdfa';

interface PdfAState {
  open: boolean;
  // null: Prüfung läuft
  report: PdfAReport | null;
  setOpen: (open: boolean) => void;
  setReport: (report: PdfAReport | null) => void;
}

export const usePdfA = create<PdfAState>((set) => ({
  open: false,
  report: null,
  setOpen: (open) => set({ open, report: null }),
  setReport: (report) => set({ report }),
}));
