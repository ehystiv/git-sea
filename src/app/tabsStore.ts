import { create } from "zustand";
import { persist } from "zustand/middleware";
import { commands, type RepoInfo } from "../lib/bindings";
import * as logic from "./tabsLogic";

interface TabsStore extends logic.TabsData {
  /** The tabs saved by the last launch, reopened by `restore`. */
  saved: logic.SavedSession;
  /** False until `restore` is done; until then the saved session is kept as it was. */
  restored: boolean;
  addTab: (repo: RepoInfo) => void;
  addTabAlongside: (repo: RepoInfo) => void;
  closeTab: (id: string) => void;
  openSplit: (id: string) => void;
  closeSplit: () => void;
  swapSplit: () => void;
  activate: (id: string) => void;
  activateAt: (position: number, last?: boolean) => void;
  moveTab: (id: string, to: number) => void;
  removeRecent: (path: string) => void;
  restore: () => Promise<void>;
}

let restoring = false;

/** Open tabs and the list of recent repositories are remembered across launches. */
export const useTabs = create<TabsStore>()(
  persist(
    (set, get) => ({
      ...logic.emptyTabs,
      saved: logic.emptySession,
      restored: false,
      addTab: (repo) => set((s) => logic.addTab(s, repo)),
      addTabAlongside: (repo) => set((s) => logic.addTabAlongside(s, repo)),
      closeTab: (id) => set((s) => logic.closeTab(s, id)),
      openSplit: (id) => set((s) => logic.openSplit(s, id)),
      closeSplit: () => set((s) => logic.closeSplit(s)),
      swapSplit: () => set((s) => logic.swapSplit(s)),
      activate: (id) => set((s) => logic.activate(s, id)),
      activateAt: (position, last) => set((s) => logic.activateAt(s, position, last)),
      moveTab: (id, to) => set((s) => logic.moveTab(s, id, to)),
      removeRecent: (path) => set((s) => logic.removeRecent(s, path)),
      restore: async () => {
        // React's strict mode runs effects twice; the repositories must be opened once.
        if (restoring || get().restored) return;
        restoring = true;
        const { paths, active, split } = get().saved;
        // A repository that was moved or deleted since is simply left out.
        const opened = await Promise.all(
          paths.map((path) =>
            commands
              .openRepo(path)
              .then((result) => (result.status === "ok" ? result.data : null))
              .catch(() => null),
          ),
        );
        const repos = opened.filter((repo): repo is RepoInfo => repo !== null);
        const { data, duplicates } = logic.restoreTabs(get(), repos, active, split ?? null);
        for (const id of duplicates) void commands.closeRepo(id);
        set({ ...data, restored: true });
      },
    }),
    {
      name: "git-sea:recents",
      partialize: (s) => ({ recents: s.recents, saved: s.restored ? logic.sessionOf(s) : s.saved }),
    },
  ),
);
