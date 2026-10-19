import type { RefLabel } from "../../lib/bindings";
import type { GraphIndex } from "./GraphIndex";

/** The refs whose history holds a commit, as `git branch -a --contains` and `git tag --contains`. */
export interface Containment {
  /** Local branches, HEAD's first, then by name. */
  branches: RefLabel[];
  /** Remote branches, by name. */
  remotes: RefLabel[];
  /** Tags, oldest first (by the time of the commit they point to). */
  tags: RefLabel[];
  /** The oldest tag that holds the commit: the first release it went out in. */
  firstTag: RefLabel | null;
}

/**
 * Walks from column `at` of `index` to all its loaded descendants (through the children, so a
 * recent commit costs only the few commits above it) and collects the refs found on the way.
 */
export function containingRefs(index: GraphIndex, at: number): Containment {
  const result: Containment = { branches: [], remotes: [], tags: [], firstTag: null };
  if (at < 0 || at >= index.length) return result;

  const seen = new Uint8Array(index.length);
  const stack = [at];
  seen[at] = 1;
  const tagTime = new Map<RefLabel, number>();
  const tagColumn = new Map<RefLabel, number>();
  while (stack.length > 0) {
    const column = stack.pop() ?? 0;
    const commit = index.commits[column];
    for (const ref of (commit && index.refs.get(commit.id)) ?? []) {
      if (ref.kind === "Tag") {
        result.tags.push(ref);
        tagTime.set(ref, commit?.time ?? 0);
        tagColumn.set(ref, column);
      } else if (ref.kind === "Remote") result.remotes.push(ref);
      else result.branches.push(ref);
    }
    for (const child of index.children(column)) {
      if (seen[child]) continue;
      seen[child] = 1;
      stack.push(child);
    }
  }

  const byName = (a: RefLabel, b: RefLabel) => a.name.localeCompare(b.name);
  result.branches.sort((a, b) => Number(b.kind === "Head") - Number(a.kind === "Head") || byName(a, b));
  result.remotes.sort(byName);
  // Same time: the one nearer the commit (later in the walk) first, then by name.
  result.tags.sort(
    (a, b) => (tagTime.get(a) ?? 0) - (tagTime.get(b) ?? 0) || (tagColumn.get(b) ?? 0) - (tagColumn.get(a) ?? 0) || byName(a, b),
  );
  result.firstTag = result.tags[0] ?? null;
  return result;
}
