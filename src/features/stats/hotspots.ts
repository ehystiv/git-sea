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
      const key = childOf(path, dir);
      if (key === null || seen.has(key)) continue;
      const rest = path.slice(dir.length);
      const slash = rest.indexOf("/");
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

/** What right inside `dir` holds `path`: the file itself, or the directory (ending with `/`). */
function childOf(path: string, dir: string): string | null {
  if (!path.startsWith(dir)) return null;
  const slash = path.indexOf("/", dir.length);
  return slash < 0 ? path : path.slice(0, slash + 1);
}

/** A month of the heatmap: `key` is `2026-10`; `start` and `end` (excluded) are Unix seconds. */
export interface HeatMonth {
  key: string;
  start: number;
  end: number;
}

export interface Heatmap {
  months: HeatMonth[];
  /** The most changed things right inside the directory, with their commits in each month. */
  rows: Array<{ spot: Hotspot; counts: number[] }>;
  /** The highest count of any cell. */
  max: number;
}

/**
 * When the `limit` most changed files and directories right inside `dir` changed: commits per
 * local month, from the first month with a change to the last. Undated commits are left out.
 */
export function fileHeatmap(commits: readonly CommitSummary[], files: ReadonlyMap<string, readonly string[]>, dir: string, limit: number, include: (commit: CommitSummary) => boolean = () => true): Heatmap {
  const spots = hotspots(commits, files, dir, include).slice(0, limit);
  const rowOf = new Map(spots.map((spot, i) => [spot.path, i]));
  const events: Array<{ row: number; month: number }> = [];
  let first = Infinity;
  let last = -Infinity;
  for (const commit of commits) {
    const changed = files.get(commit.id);
    const time = commit.time;
    if (!changed || time === null || !Number.isFinite(time) || !include(commit)) continue;
    const date = new Date(time * 1000);
    const month = date.getFullYear() * 12 + date.getMonth();
    const seen = new Set<number>();
    for (const path of changed) {
      const key = childOf(path, dir);
      const row = key === null ? undefined : rowOf.get(key);
      if (row === undefined || seen.has(row)) continue;
      seen.add(row);
      events.push({ row, month });
      first = Math.min(first, month);
      last = Math.max(last, month);
    }
  }
  if (events.length === 0) return { months: [], rows: spots.map((spot) => ({ spot, counts: [] })), max: 0 };
  const months: HeatMonth[] = [];
  for (let n = first; n <= last; n++) {
    const year = Math.floor(n / 12);
    const month = n % 12;
    months.push({ key: `${year}-${String(month + 1).padStart(2, "0")}`, start: new Date(year, month, 1).getTime() / 1000, end: new Date(year, month + 1, 1).getTime() / 1000 });
  }
  const rows = spots.map((spot) => ({ spot, counts: new Array<number>(months.length).fill(0) }));
  let max = 0;
  for (const { row, month } of events) {
    const counts = rows[row]?.counts;
    if (!counts) continue;
    const at = month - first;
    counts[at] = (counts[at] ?? 0) + 1;
    max = Math.max(max, counts[at] ?? 0);
  }
  return { months, rows, max };
}

/** The search for the commits that changed a file or directory in a month. */
export function monthSearch(spot: Pick<Hotspot, "path">, month: HeatMonth): string {
  const next = new Date(month.end * 1000);
  const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  return `${pathSearch(spot)} after:${month.key} before:${key}`;
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
