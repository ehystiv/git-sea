import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TypeColorsStore {
  /** Graph nodes outlined by their Conventional Commits type (feat, fix…) instead of by branch. */
  enabled: boolean;
  toggle: () => void;
}

export const useTypeColors = create<TypeColorsStore>()(
  persist(
    (set) => ({
      enabled: false,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: "git-sea:type-colors", partialize: (s) => ({ enabled: s.enabled }) },
  ),
);
