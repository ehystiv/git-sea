import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FlowStore {
  /** Dots travelling along the links of the graph and the timeline. */
  enabled: boolean;
  toggle: () => void;
}

/** On by default, except for people who asked the system to reduce motion. */
function defaultEnabled(): boolean {
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

export const useFlow = create<FlowStore>()(
  persist(
    (set) => ({
      enabled: defaultEnabled(),
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: "git-sea:flow", partialize: (s) => ({ enabled: s.enabled }) },
  ),
);
