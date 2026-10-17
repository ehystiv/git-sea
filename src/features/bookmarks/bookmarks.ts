/** Bookmarked commit ids per repository (by normalized path), the latest added first. */
export type Bookmarks = Readonly<Record<string, readonly string[]>>;

/** Bookmarks kept per repository; the oldest go first. */
export const MAX_BOOKMARKS = 50;

export function bookmarksOf(all: Bookmarks, repo: string): readonly string[] {
  return all[repo] ?? [];
}

/** Adds the commit to the front of the repository's bookmarks, or removes it if it is there. */
export function toggleBookmark(all: Bookmarks, repo: string, id: string): Bookmarks {
  const list = bookmarksOf(all, repo);
  const next = list.includes(id) ? list.filter((b) => b !== id) : [id, ...list].slice(0, MAX_BOOKMARKS);
  const rest: Record<string, readonly string[]> = { ...all };
  delete rest[repo];
  return next.length > 0 ? { ...rest, [repo]: next } : rest;
}
