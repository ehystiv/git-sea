import { laneEdgeEmphasis, maskFromIds, type Emphasis } from "./emphasis";
import type { GraphIndex } from "./GraphIndex";

/** Flags of `Divergence.flags`: reachable from `a`, from `b`, or from both. */
export const ONLY_A = 1;
export const ONLY_B = 2;
const BOTH = ONLY_A | ONLY_B;

/** How two commits of the history split apart, as `git rev-list --left-right --count a...b`. */
export interface Divergence {
  /** Commits reachable from `a` and not from `b`. */
  ahead: number;
  /** Commits reachable from `b` and not from `a`. */
  behind: number;
  /** Per column of the index: `ONLY_A`, `ONLY_B`, both, or 0 (not looked at, or reachable from neither). */
  flags: Uint8Array;
}

/**
 * Compares columns `a` and `b` of `index` by painting their ancestors with two colours, column by
 * column in walk order. The walk is topological (children before parents), so a column's flags
 * are final when it is reached, and the scan stops as soon as every painted column still ahead is
 * shared: everything below is shared too. Branches that split recently cost only a few columns.
 */
export function divergence(index: GraphIndex, a: number, b: number): Divergence {
  const flags = new Uint8Array(index.length);
  if (a < 0 || b < 0 || a >= index.length || b >= index.length) return { ahead: 0, behind: 0, flags };
  let ahead = 0;
  let behind = 0;
  // Painted columns not reached yet that belong to one side only.
  let open = 0;
  const paint = (column: number, side: number) => {
    const before = flags[column] ?? 0;
    const after = before | side;
    if (after === before) return;
    flags[column] = after;
    if (before === 0 && after !== BOTH) open++;
    else if (before !== 0 && after === BOTH) open--;
  };
  paint(a, ONLY_A);
  paint(b, ONLY_B);

  for (let column = Math.min(a, b); column < index.length && open > 0; column++) {
    const side = flags[column] ?? 0;
    if (side === 0) continue;
    if (side === ONLY_A) ahead++;
    else if (side === ONLY_B) behind++;
    if (side !== BOTH) open--;
    for (const parent of index.commits[column]?.parents ?? []) {
      const p = index.indexOf(parent);
      // A parent that is not loaded (cut by the branch filter) ends that line.
      if (p !== null && p > column) paint(p, side);
    }
  }
  return { ahead, behind, flags };
}

/**
 * Emphasis for a divergence computed on the full `index`, drawn on `view` (the same index, or its
 * compressed projection). Bright: the commits of the sides in `sides` and the two end points.
 */
export function divergenceEmphasis(
  index: GraphIndex,
  view: GraphIndex,
  result: Divergence,
  ends: readonly string[],
  sides: number = ONLY_A | ONLY_B,
): Emphasis & ReturnType<typeof laneEdgeEmphasis> {
  let nodes: Uint8Array;
  if (view === index) {
    nodes = new Uint8Array(index.length);
    result.flags.forEach((flag, i) => {
      if (flag !== BOTH && flag & sides) nodes[i] = 1;
    });
    for (const id of ends) {
      const at = index.indexOf(id);
      if (at !== null) nodes[at] = 1;
    }
  } else {
    const ids = [...ends];
    result.flags.forEach((flag, i) => {
      const id = index.commits[i]?.id;
      if (id !== undefined && flag !== BOTH && flag & sides) ids.push(id);
    });
    nodes = maskFromIds(view, ids);
  }
  return { nodes, ...laneEdgeEmphasis(view, nodes) };
}
