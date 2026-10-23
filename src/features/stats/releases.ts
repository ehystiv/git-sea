import type { RefLabel } from "../../lib/bindings";
import { authorsOf } from "../commits/authors";
import type { GraphIndex } from "../graph/GraphIndex";

const DAY = 86_400;

/** A tag and the commits that first went out in it. */
export interface Release {
  /** The tag; others on the same commit are in `aliases`. */
  name: string;
  aliases: string[];
  commit: string;
  /** Unix seconds of the tagged commit, or null. */
  time: number | null;
  /** Commits in its history that no older tag holds. */
  commits: number;
  /** People who made those commits, co-authors included. */
  authors: number;
  /** The release before it by date, and the days between the two. */
  previous: { name: string; commit: string } | null;
  days: number | null;
}

export interface ReleaseStats {
  /** Newest first. */
  releases: Release[];
  /** Commits in HEAD's history that no tag holds: what the next release would bring. */
  pending: number;
  /** The oldest of those, or null. */
  pendingSince: number | null;
  /** HEAD's commit, when loaded. */
  head: string | null;
  /** Middle value of the days between consecutive releases, or null with fewer than two. */
  medianDays: number | null;
  /** Releases in the 365 days up to `now`. */
  lastYear: number;
}

/**
 * The tags of the loaded history as releases: each commit belongs to the oldest tag (by the date
 * of the tagged commit) whose history holds it, as `git describe --contains` would put it.
 * `now` is Unix seconds.
 */
export function releaseStats(index: GraphIndex, now: number = Date.now() / 1000): ReleaseStats {
  const tags = new Map<number, RefLabel[]>();
  let head: number | null = null;
  for (const [commit, labels] of index.refs) {
    const at = index.indexOf(commit);
    if (at === null || index.commits[at]?.id !== commit) continue;
    for (const label of labels) {
      if (label.kind === "Tag") tags.set(at, [...(tags.get(at) ?? []), label]);
      if (label.kind === "Head") head = at;
    }
  }
  const timeOf = (at: number) => index.commits[at]?.time ?? null;
  const order = [...tags.keys()].sort((a, b) => (timeOf(a) ?? -Infinity) - (timeOf(b) ?? -Infinity) || b - a);

  const owner = new Int32Array(index.length).fill(-1);
  const parentsOf = (at: number) => (index.commits[at]?.parents ?? []).flatMap((id) => index.indexOf(id) ?? []);
  const releasesOldestFirst: Release[] = [];
  order.forEach((at, n) => {
    const labels = [...(tags.get(at) ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const people = new Set<string>();
    let commits = 0;
    const stack = owner[at] === -1 ? [at] : [];
    if (owner[at] === -1) owner[at] = n;
    while (stack.length > 0) {
      const column = stack.pop() ?? 0;
      commits++;
      const commit = index.commits[column];
      if (commit) for (const name of authorsOf(commit)) people.add(name);
      for (const parent of parentsOf(column)) {
        if (owner[parent] !== -1) continue;
        owner[parent] = n;
        stack.push(parent);
      }
    }
    const before = releasesOldestFirst[releasesOldestFirst.length - 1] ?? null;
    const time = timeOf(at);
    releasesOldestFirst.push({
      name: labels[0]?.name ?? "",
      aliases: labels.slice(1).map((l) => l.name),
      commit: index.commits[at]?.id ?? "",
      time,
      commits,
      authors: people.size,
      previous: before ? { name: before.name, commit: before.commit } : null,
      days: before && before.time !== null && time !== null ? (time - before.time) / DAY : null,
    });
  });

  // What HEAD has that no tag holds.
  let pending = 0;
  let pendingSince: number | null = null;
  if (head !== null && owner[head] === -1) {
    const seen = new Uint8Array(index.length);
    const stack = [head];
    seen[head] = 1;
    while (stack.length > 0) {
      const column = stack.pop() ?? 0;
      pending++;
      const time = timeOf(column);
      if (time !== null && (pendingSince === null || time < pendingSince)) pendingSince = time;
      for (const parent of parentsOf(column)) {
        if (seen[parent] || owner[parent] !== -1) continue;
        seen[parent] = 1;
        stack.push(parent);
      }
    }
  }

  const gaps = releasesOldestFirst.flatMap((r) => (r.days === null ? [] : [r.days])).sort((a, b) => a - b);
  const middle = gaps.length / 2;
  const medianDays = gaps.length === 0 ? null : gaps.length % 2 ? (gaps[Math.floor(middle)] ?? null) : ((gaps[middle - 1] ?? 0) + (gaps[middle] ?? 0)) / 2;
  const lastYear = releasesOldestFirst.filter((r) => r.time !== null && r.time > now - 365 * DAY).length;
  return { releases: releasesOldestFirst.reverse(), pending, pendingSince, head: head === null ? null : (index.commits[head]?.id ?? null), medianDays, lastYear };
}
