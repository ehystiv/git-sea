import type { CommitSummary, FileActivity } from "../../lib/bindings";
import { authorsOf } from "../commits/authors";

/** A file or directory and how often it changed. */
export interface Hotspot {
  /** Full path; directories end with `/`. */
  path: string;
  /** Last part of the path, with the `/` of a directory. */
  name: string;
  isDir: boolean;
  /** Commits that changed it (for a directory, any file in it). */
  commits: number;
  /** Who made those commits, most first: a co-authored commit counts for each author. */
  authors: Array<{ name: string; commits: number }>;
  /** Unix seconds of the newest of those commits, or null when none has a date. */
  last: number | null;
}

/** Commit id -> paths it changed, from what the backend sends. */
export function filesByCommit(activity: FileActivity): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const commit of activity.commits) {
    map.set(
      commit.id,
      commit.files.flatMap((i) => activity.paths[i] ?? []),
    );
  }
  return map;
}

/**
 * The files and directories right inside `dir` (`""` for the root, else ending with `/`), ranked
 * by how many of `commits` changed them, then by path. Only the commits for which `include`
 * holds count; merges are not in `files`, so they never do.
 */
export function hotspots(commits: readonly CommitSummary[], files: ReadonlyMap<string, readonly string[]>, dir: string, include: (commit: CommitSummary) => boolean = () => true): Hotspot[] {
  const byPath = new Map<string, { spot: Hotspot; authors: Map<string, number> }>();
  for (const commit of commits) {
    const changed = files.get(commit.id);
    if (!changed || !include(commit)) continue;
    // A commit counts once for a directory, however many of its files it changed.
    const seen = new Set<string>();
    for (const path of changed) {
      if (!path.startsWith(dir)) continue;
      const rest = path.slice(dir.length);
      const slash = rest.indexOf("/");
      const key = slash < 0 ? path : dir + rest.slice(0, slash + 1);
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = byPath.get(key);
      if (!entry) {
        const isDir = slash >= 0;
        entry = { spot: { path: key, name: isDir ? rest.slice(0, slash + 1) : rest, isDir, commits: 0, authors: [], last: null }, authors: new Map() };
        byPath.set(key, entry);
      }
      entry.spot.commits++;
      for (const name of authorsOf(commit)) entry.authors.set(name, (entry.authors.get(name) ?? 0) + 1);
      const time = commit.time;
      if (time !== null && Number.isFinite(time) && (entry.spot.last === null || time > entry.spot.last)) entry.spot.last = time;
    }
  }
  const spots = [...byPath.values()].map(({ spot, authors }) => {
    spot.authors = [...authors].map(([name, n]) => ({ name, commits: n })).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
    return spot;
  });
  return spots.sort((a, b) => b.commits - a.commits || (a.path < b.path ? -1 : 1));
}

/** The directories from the root to `dir`, for a breadcrumb: `[["", root], ["src/", "src"], …]`. */
export function dirTrail(dir: string): Array<{ dir: string; name: string }> {
  const parts = dir.split("/").filter(Boolean);
  return parts.map((name, i) => ({ dir: `${parts.slice(0, i + 1).join("/")}/`, name }));
}

/** The search for the commits that changed a file or directory. */
export function pathSearch(spot: Pick<Hotspot, "path">): string {
  return `path:${spot.path.replace(/\/$/, "")}`;
}
