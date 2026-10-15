// Mit Zertifikat unterschreiben (Phase 7): gewählte digitale ID und laufendes Aufziehen des Unterschriftsfelds.
import { create } from 'zustand';
import type { SignRequestInput } from '../../../shared/signing';

export interface DigitalId {
  name: string;
  bytes: Uint8Array;
}

interface CertifyState {
  dialogOpen: boolean;
  createOpen: boolean;
  detailsOpen: boolean;
  id: DigitalId | null;
  // Unterschrift wartet auf das Feld: Rechteck auf einer Seite aufziehen
  placement: { tabId: string; request: Omit<SignRequestInput, 'placement'> } | null;
  setDialogOpen: (open: boolean) => void;
  setCreateOpen: (open: boolean) => void;
  setDetailsOpen: (open: boolean) => void;
  setId: (id: DigitalId | null) => void;
  setPlacement: (placement: CertifyState['placement']) => void;
}

export const useCertify = create<CertifyState>((set) => ({
  dialogOpen: false,
  createOpen: false,
  detailsOpen: false,
  id: null,
  placement: null,
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
  setCreateOpen: (createOpen) => set({ createOpen }),
  setDetailsOpen: (detailsOpen) => set({ detailsOpen }),
  setId: (id) => set({ id }),
  setPlacement: (placement) => set({ placement }),
}));
