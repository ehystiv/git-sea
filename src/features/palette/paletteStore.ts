import { useEffect } from "react";
import { create } from "zustand";
import type { PaletteCommand } from "./rank";

/** What one part of the app (the window, the active repository) offers to the palette. */
export interface PaletteSource {
  commands: PaletteCommand[];
  /** Results that depend on the typed text (refs, commits); already filtered and capped. */
  search?: (query: string) => PaletteCommand[];
}

interface PaletteStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  sources: Record<string, PaletteSource>;
  register: (key: string, source: PaletteSource | null) => void;
}

export const usePalette = create<PaletteStore>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  sources: {},
  register: (key, source) =>
    set((s) => {
      const sources = { ...s.sources };
      if (source) sources[key] = source;
      else delete sources[key];
      return { sources };
    }),
}));

/** Offers `source` to the palette while the component is mounted; null withdraws it. */
export function usePaletteSource(key: string, source: PaletteSource | null): void {
  const register = usePalette((s) => s.register);
  useEffect(() => {
    register(key, source);
    return () => register(key, null);
  }, [key, source, register]);
}
