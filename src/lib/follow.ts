import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FollowStore {
  /** After a reload the graph moves to HEAD when it changed, or to the newest new commit. */
  enabled: boolean;
  toggle: () => void;
}

export const useFollow = create<FollowStore>()(
  persist(
    (set) => ({
      enabled: true,
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    { name: "git-sea:follow", partialize: (s) => ({ enabled: s.enabled }) },
  ),
);
