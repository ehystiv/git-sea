import type { CommitSummary } from "../../lib/bindings";

/**
 * The author of a commit, then the co-authors its message names. A co-author who is the author
 * too (often so once the mailmap is applied) is left out: each person once.
 */
export function authorsOf(commit: CommitSummary): string[] {
  const co = commit.coAuthors;
  if (!co?.length) return [commit.author];
  return [commit.author, ...co.filter((name) => name !== commit.author)];
}
