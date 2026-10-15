import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RepoInfo } from "../lib/bindings";
import * as logic from "./tabsLogic";

interface TabsStore extends logic.TabsData {
  addTab: (repo: RepoInfo) => void;
  closeTab: (id: string) => void;
  activate: (id: string) => void;
  activateAt: (position: number, last?: boolean) => void;
  removeRecent: (path: string) => void;
}

/** Open tabs live only for the session; the list of recent repositories is remembered. */
export const useTabs = create<TabsStore>()(
  persist(
    (set) => ({
      ...logic.emptyTabs,
      addTab: (repo) => set((s) => logic.addTab(s, repo)),
      closeTab: (id) => set((s) => logic.closeTab(s, id)),
      activate: (id) => set((s) => logic.activate(s, id)),
      activateAt: (position, last) => set((s) => logic.activateAt(s, position, last)),
      removeRecent: (path) => set((s) => logic.removeRecent(s, path)),
    }),
    {
      name: "git-sea:recents",
      partialize: (s) => ({ recents: s.recents }),
    },
  ),
);
