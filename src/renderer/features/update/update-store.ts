// Updates ohne Internet (ADR 0025): Stand prüfen beim Start und wenn das Fenster nach vorn kommt; Hinweis ausblenden
// gilt nur für die angezeigte Version.
import { create } from 'zustand';
import type { UpdateStatus } from '../../../shared/update';
import { api } from '../../api';

interface UpdateState {
  status: UpdateStatus | null;
  dismissed: string | null;
  installing: boolean;
  check: () => Promise<UpdateStatus | null>;
  dismiss: () => void;
  install: () => Promise<boolean>;
}

export const useUpdate = create<UpdateState>((set, get) => ({
  status: null,
  dismissed: null,
  installing: false,
  check: async () => {
    try {
      const status = await api.update.status();
      set({ status });
      return status;
    } catch {
      return null;
    }
  },
  dismiss: () => {
    const status = get().status;
    if (status?.state === 'available') set({ dismissed: status.version });
  },
  install: async () => {
    set({ installing: true });
    const started = await api.update.install().catch(() => false);
    // Abgebrochen (z. B. „Abbrechen“ bei der Rückfrage zum Speichern): Das Update bleibt vorgemerkt und kommt beim
    // nächsten Beenden
    set({ installing: false });
    return started;
  },
}));
