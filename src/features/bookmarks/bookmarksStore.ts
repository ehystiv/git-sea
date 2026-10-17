import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toggleBookmark, type Bookmarks } from "./bookmarks";

interface BookmarksStore {
  all: Bookmarks;
  toggle: (repo: string, id: string) => void;
}

/** Bookmarked commits, remembered across launches. */
export const useBookmarks = create<BookmarksStore>()(
  persist(
    (set) => ({
      all: {},
      toggle: (repo, id) => set((s) => ({ all: toggleBookmark(s.all, repo, id) })),
    }),
    { name: "git-sea:bookmarks" },
  ),
);
