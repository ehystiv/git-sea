import type { CommitSummary } from "../../lib/bindings";
import { GraphIndex } from "./GraphIndex";

/** Shorter runs are left as they are: one node for one or two commits would hide more than it saves. */
export const MIN_GROUP = 3;

/**
 * The compressed ("topological") projection of a history: every run of plain linear commits
 * becomes one node standing for N commits, so only forks, merges, branch tips and roots remain.
 *
 * A commit is part of a run when it has exactly one parent and one child and no branch, tag or
 * HEAD points at it. Runs are chains of such commits on one lane; each one is shown at the column
 * of its newest commit, with that commit's lane and edges, so the base layout stays valid (the
 * lines of other lanes simply run past the columns that disappeared). Runs in `expanded` (named
 * by their newest commit) are left open; `openRuns` lists their commits so a click can close them again.
 */
export function compressIndex(base: GraphIndex, expanded: ReadonlySet<string>): GraphIndex {
  const count = base.length;
  /** Index of the newest commit of the run a commit belongs to, -1 for commits that stay as they are. */
  const first = new Int32Array(count).fill(-1);
  const size = new Int32Array(count);
  const oldest = new Int32Array(count);

  for (let i = 0; i < count; i++) {
    const commit = base.commits[i];
    const row = base.rows[i];
    if (!commit || !row || commit.parents.length !== 1 || (base.refs.get(commit.id)?.length ?? 0) > 0) continue;
    const child = base.soleChild(i);
    if (child === null) continue;
    const childFirst = first[child] ?? -1;
    const joins = childFirst >= 0 && base.rows[child]?.lane === row.lane;
    const head = joins ? childFirst : i;
    first[i] = head;
    size[head] = (size[head] ?? 0) + 1;
    oldest[head] = i;
  }

  const commits: CommitSummary[] = [];
  const rows = [];
  const out = new GraphIndex();
  const nodeOf = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const commit = base.commits[i];
    const row = base.rows[i];
    if (!commit || !row) continue;
    const head = first[i] ?? -1;
    const collapsed = head >= 0 && (size[head] ?? 0) >= MIN_GROUP && !expanded.has(base.commits[head]?.id ?? "");
    if (!collapsed) {
      commits.push(commit);
      rows.push(row);
      if (head >= 0 && (size[head] ?? 0) >= MIN_GROUP) out.openRuns.set(commit.id, base.commits[head]?.id ?? commit.id);
    } else if (head === i) {
      const last = base.commits[oldest[i] ?? i] ?? commit;
      nodeOf.set(i, commits.length);
      out.groups.set(commits.length, { count: size[i] ?? 1, oldestId: last.id });
      // The node leads to whatever the run's oldest commit leads to.
      commits.push({ ...commit, parents: last.parents });
      rows.push(row);
    } else {
      out.aliases.set(commit.id, nodeOf.get(head) ?? 0);
    }
  }

  out.appendChunk(commits, rows);
  out.refs = base.refs;
  return out;
}
