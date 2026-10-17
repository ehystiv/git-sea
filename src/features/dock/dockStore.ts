import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Corner } from "./dock";

export type DockWidget = "zoom" | "minimap";

interface DockStore {
  corners: Record<DockWidget, Corner>;
  /** The widget moved last keeps its corner when the two would collide. */
  last: DockWidget | null;
  move: (widget: DockWidget, corner: Corner) => void;
}

/** Where the floating widgets rest, the same in every view and tab, remembered across launches. */
export const useDock = create<DockStore>()(
  persist(
    (set) => ({
      corners: { zoom: "bottom-left", minimap: "bottom-right" },
      last: null,
      move: (widget, corner) => set((s) => ({ corners: { ...s.corners, [widget]: corner }, last: widget })),
    }),
    { name: "git-sea:dock" },
  ),
);
