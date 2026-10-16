import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SeaStore {
  /** Fish swimming behind the graph. */
  enabled: boolean;
  toggle: () => void;
}

/** On by default: with reduced motion the fish stay still anyway. */
export const useSea = create<SeaStore>()(
  persist(
    (set) => ({
      enabled: true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: "git-sea:sea", partialize: (s) => ({ enabled: s.enabled }) },
  ),
);
