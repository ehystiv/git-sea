import type { GraphIndex } from "./GraphIndex";

/** How much of its colour a commit or link keeps when something else is highlighted. */
export const DIM_ALPHA = 0.18;

/**
 * Which commits (and, in the graph, which link segments) stay at full strength; everything else
 * is drawn faded. Built for one index: `nodes[i]` is column `i` of that index.
 */
export interface Emphasis {
  nodes: Uint8Array;
  /**
   * Graph only: `edges[edgeStart[i] + k]` is 1 when edge `k` of row `i` stays bright. Null means
   * every edge is faded (search results: the links between matches mean nothing).
   */
  edges: Uint8Array | null;
  edgeStart: Int32Array | null;
}

/** True when the mask was built for this index as it is now (not for an older load). */
export function emphasisFits(emphasis: Emphasis | null, index: GraphIndex): emphasis is Emphasis {
  return emphasis !== null && emphasis.nodes.length === index.length;
}

/** Column `at` and every commit it descends from, in `index`. */
export function ancestorMask(index: GraphIndex, at: number): Uint8Array {
  const mask = new Uint8Array(index.length);
  if (at < 0 || at >= index.length) return mask;
  const stack = [at];
  mask[at] = 1;
  while (stack.length > 0) {
    const column = stack.pop() ?? 0;
    for (const parent of index.commits[column]?.parents ?? []) {
      const p = index.indexOf(parent);
      if (p === null || mask[p]) continue;
      mask[p] = 1;
      stack.push(p);
    }
  }
  return mask;
}

/** The columns of `ids` in `index` (a commit hidden in a compressed node marks the node). */
export function maskFromIds(index: GraphIndex, ids: readonly string[]): Uint8Array {
  const mask = new Uint8Array(index.length);
  for (const id of ids) {
    const at = index.indexOf(id);
    if (at !== null) mask[at] = 1;
  }
  return mask;
}

/**
 * Which edge segments of the graph belong to a link that starts at a bright commit, found by
 * replaying the lanes from the newest column to the oldest. A lane carries the link from the
 * commit that opened it (`Out`, `ForkOut`) until a commit takes it in (`In`, `MergeIn`). For a
 * set closed under parents, like the ancestors of a commit, this lights exactly the links
 * between bright commits.
 */
export function laneEdgeEmphasis(index: GraphIndex, nodes: Uint8Array): { edges: Uint8Array; edgeStart: Int32Array } {
  const rows = index.rows;
  const edgeStart = new Int32Array(rows.length + 1);
  for (let r = 0; r < rows.length; r++) edgeStart[r + 1] = (edgeStart[r] ?? 0) + (rows[r]?.edges.length ?? 0);
  const edges = new Uint8Array(edgeStart[rows.length] ?? 0);
  const lane = new Uint8Array(index.maxLane + 1);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const bright = nodes[r] ?? 0;
    const base = edgeStart[r] ?? 0;
    // Children side first: what arrives is read before the parents side reuses the lanes.
    row.edges.forEach((edge, k) => {
      if (edge.kind === "Through") edges[base + k] = lane[edge.fromLane] ?? 0;
      else if (edge.kind === "In") edges[base + k] = (lane[edge.fromLane] ?? 0) & bright;
      else if (edge.kind === "MergeIn") {
        edges[base + k] = (lane[edge.fromLane] ?? 0) & bright;
        lane[edge.fromLane] = 0;
      }
    });
    lane[row.lane] = 0;
    row.edges.forEach((edge, k) => {
      if (edge.kind === "Out") {
        edges[base + k] = bright;
        lane[row.lane] = bright;
      } else if (edge.kind === "ForkOut") {
        edges[base + k] = bright;
        // A lane already waiting for the same parent carries both links.
        lane[edge.toLane] = (lane[edge.toLane] ?? 0) | bright;
      }
    });
  }
  return { edges, edgeStart };
}

/** The ancestors of column `at`, with the graph's links between them. */
export function ancestorEmphasis(index: GraphIndex, at: number): Emphasis & ReturnType<typeof laneEdgeEmphasis> {
  const nodes = ancestorMask(index, at);
  return { nodes, ...laneEdgeEmphasis(index, nodes) };
}

/** Search results: the matching commits, every link faded. */
export function matchEmphasis(index: GraphIndex, ids: readonly string[]): Emphasis {
  return { nodes: maskFromIds(index, ids), edges: null, edgeStart: null };
}
