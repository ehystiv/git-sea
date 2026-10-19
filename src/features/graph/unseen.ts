import { COLUMN_W, LANE_H } from "./constants";
import type { View } from "./draw";
import type { GraphIndex } from "./GraphIndex";

/** Where something off screen is, seen from the view. */
export type Side = "left" | "right" | "up" | "down";

/** Commits `after` shows that `before` did not (not even inside a node), newest first. */
export function newCommitIds(before: GraphIndex, after: GraphIndex): string[] {
  if (before.length === 0) return [];
  const ids: string[] = [];
  for (const commit of after.commits) {
    if (before.indexOf(commit.id) === null) ids.push(commit.id);
  }
  return ids;
}

/** Column of the newest of these commits still in `index`, or null when none is. */
export function newestColumn(index: GraphIndex, ids: readonly string[]): number | null {
  let best: number | null = null;
  for (const id of ids) {
    const at = index.indexOf(id);
    if (at !== null && (best === null || at < best)) best = at;
  }
  return best;
}

/** Which way the commit at `column` is from the view, or null when its node is on screen. */
export function sideOf(index: GraphIndex, view: View, width: number, height: number, column: number): Side | null {
  const x = -column * COLUMN_W * view.z + view.tx;
  const y = (index.rows[column]?.lane ?? 0) * LANE_H * view.z + view.ty;
  if (x < 0) return "left";
  if (x > width) return "right";
  if (y < 0) return "up";
  if (y > height) return "down";
  return null;
}

/** The commit HEAD points to, or null when there is none (unborn branch, filtered out). */
export function headId(index: GraphIndex): string | null {
  for (const labels of index.refs.values()) {
    for (const label of labels) if (label.kind === "Head") return label.commit;
  }
  return null;
}

/**
 * Column the view should move to after a reload: HEAD's when HEAD changed, otherwise the newest of
 * the `added` commits; null when neither is in `after`.
 */
export function followColumn(before: GraphIndex, after: GraphIndex, added: readonly string[]): number | null {
  const head = headId(after);
  if (head !== null && head !== headId(before)) {
    const at = after.indexOf(head);
    if (at !== null) return at;
  }
  return newestColumn(after, added);
}
