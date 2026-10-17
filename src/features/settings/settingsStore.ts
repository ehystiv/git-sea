import { create } from "zustand";

interface SettingsStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the settings dialog is shown. */
export const useSettings = create<SettingsStore>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
