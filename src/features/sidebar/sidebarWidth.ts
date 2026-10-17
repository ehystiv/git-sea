import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_DEFAULT = 232;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 520;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

interface SidebarWidthStore {
  width: number;
  setWidth: (width: number) => void;
  reset: () => void;
}

/** The sidebar's width, the same in every tab and remembered across launches. */
export const useSidebarWidth = create<SidebarWidthStore>()(
  persist(
    (set) => ({
      width: SIDEBAR_DEFAULT,
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
      reset: () => set({ width: SIDEBAR_DEFAULT }),
    }),
    { name: "git-sea:sidebar-width" },
  ),
);
