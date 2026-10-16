import type { CommitSummary } from "../../lib/bindings";

/**
 * What a search looks at. `text` (no prefix) matches the subject, the author or the start of the
 * hash, right in the frontend; `message` and `path` need the backend (whole message, changed files).
 */
export type SearchMode = "text" | "author" | "hash" | "message" | "path";

export interface SearchQuery {
  mode: SearchMode;
  /** The words after the prefix, trimmed. */
  text: string;
}

const PREFIXES: Record<string, SearchMode> = {
  author: "author",
  autore: "author",
  hash: "hash",
  msg: "message",
  message: "message",
  messaggio: "message",
  path: "path",
  file: "path",
};

/** Help shown under the search field, one line per prefix. */
export const SEARCH_HELP: Array<{ prefix: string; meaning: string }> = [
  { prefix: "", meaning: "oggetto, autore o inizio dell'hash" },
  { prefix: "author:", meaning: "solo l'autore" },
  { prefix: "hash:", meaning: "solo l'hash" },
  { prefix: "msg:", meaning: "tutto il messaggio, corpo compreso" },
  { prefix: "path:", meaning: "commit che hanno cambiato un file o una cartella" },
];

/** Reads `author:anna`, `path: src/lib`, or plain words. Null when there is nothing to look for. */
export function parseQuery(raw: string): SearchQuery | null {
  const match = /^\s*([a-z]+):\s*(.*)$/i.exec(raw);
  const mode = match ? PREFIXES[match[1]?.toLowerCase() ?? ""] : undefined;
  const query: SearchQuery = mode && match ? { mode, text: (match[2] ?? "").trim() } : { mode: "text", text: raw.trim() };
  return query.text === "" ? null : query;
}

/** True for searches the backend runs (they read objects the frontend does not have). */
export function needsBackend(query: SearchQuery): query is SearchQuery & { mode: "message" | "path" } {
  return query.mode === "message" || query.mode === "path";
}

const HEX = /^[0-9a-f]{4,40}$/;

/** A test for one commit, for the searches the frontend can answer by itself. */
export function commitMatcher(query: SearchQuery): (commit: CommitSummary) => boolean {
  const needle = query.text.toLowerCase();
  const hash = HEX.test(needle) ? needle : null;
  switch (query.mode) {
    case "author":
      return (c) => c.author.toLowerCase().includes(needle);
    case "hash":
      return (c) => c.id.startsWith(needle);
    default:
      return (c) =>
        c.summary.toLowerCase().includes(needle) || c.author.toLowerCase().includes(needle) || (hash !== null && c.id.startsWith(hash));
  }
}

/** Ids of the matching commits, in the order of `commits` (newest first in the walk). */
export function matchCommits(commits: readonly CommitSummary[], query: SearchQuery, limit = Infinity): string[] {
  const test = commitMatcher(query);
  const ids: string[] = [];
  for (const commit of commits) {
    if (!test(commit)) continue;
    ids.push(commit.id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** `ids` (in any order) sorted by their position, dropping those `position` does not know. */
export function inWalkOrder(ids: readonly string[], position: (id: string) => number | null): string[] {
  const placed: Array<[number, string]> = [];
  for (const id of ids) {
    const at = position(id);
    if (at !== null) placed.push([at, id]);
  }
  placed.sort((a, b) => a[0] - b[0]);
  return placed.map(([, id]) => id);
}

/** The match after (or before, with `step` -1) the current one, wrapping around. */
export function stepMatch(count: number, current: number | null, step: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}
