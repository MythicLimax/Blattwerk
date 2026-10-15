// Barrierefreiheit (Phase 7): Prüfdialog geöffnet
import { create } from 'zustand';

interface AccessibilityState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useAccessibility = create<AccessibilityState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
