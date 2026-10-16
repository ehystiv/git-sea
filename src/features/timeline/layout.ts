import type { GraphIndex } from "../graph/GraphIndex";

/**
 * The history seen as a timeline: where each commit is in time, which commits come before which,
 * and every parent link sorted so the ones crossing a time window can be found without scanning
 * them all. Columns are the same as in `GraphIndex` (0 = newest in the topological walk).
 */
export interface TimelineData {
  count: number;
  /** Commit time (Unix seconds) of each column. */
  times: Float64Array;
  /** Columns sorted by time, oldest first (ties: the older column in the walk first). */
  order: Int32Array;
  /** `times` in the order of `order`, for binary search. */
  sortedTimes: Float64Array;
  tMin: number;
  tMax: number;
  /** 1 for a column that has a branch, tag or HEAD on it. */
  refMask: Uint8Array;
  edgeCount: number;
  edgeChild: Int32Array;
  edgeParent: Int32Array;
  /** 1 when the parent is the child's first parent. */
  edgeFirst: Uint8Array;
  /** Edges are sorted by `edgeStart`; the span of an edge is [edgeStart, edgeEnd]. */
  edgeStart: Float64Array;
  edgeEnd: Float64Array;
  /** Running maximum of `edgeEnd`, so the first edge reaching a time can be binary searched. */
  edgeMaxEnd: Float64Array;
}

export function buildTimeline(index: GraphIndex): TimelineData {
  const count = index.length;
  const times = new Float64Array(count);
  const refMask = new Uint8Array(count);
  // A commit without a date is placed with its neighbour in the walk, so it cannot stretch the axis to 1970.
  let known: number | null = index.commits.find((c) => c.time !== null)?.time ?? null;
  for (let i = 0; i < count; i++) {
    const commit = index.commits[i];
    if (!commit) continue;
    known = commit.time ?? known;
    times[i] = known ?? 0;
    if (index.refs.has(commit.id)) refMask[i] = 1;
  }

  const order = Int32Array.from({ length: count }, (_, i) => i).sort((a, b) => (times[a] ?? 0) - (times[b] ?? 0) || b - a);
  const sortedTimes = new Float64Array(count);
  for (let i = 0; i < count; i++) sortedTimes[i] = times[order[i] ?? 0] ?? 0;

  const child: number[] = [];
  const parent: number[] = [];
  const first: number[] = [];
  for (let c = 0; c < count; c++) {
    const parents = index.commits[c]?.parents ?? [];
    for (let k = 0; k < parents.length; k++) {
      const p = index.indexOf(parents[k] ?? "");
      if (p === null) continue;
      child.push(c);
      parent.push(p);
      first.push(k === 0 ? 1 : 0);
    }
  }
  const edgeCount = child.length;
  const start = (e: number) => Math.min(times[child[e] ?? 0] ?? 0, times[parent[e] ?? 0] ?? 0);
  const end = (e: number) => Math.max(times[child[e] ?? 0] ?? 0, times[parent[e] ?? 0] ?? 0);
  const perm = Int32Array.from({ length: edgeCount }, (_, e) => e).sort((a, b) => start(a) - start(b));

  const edgeChild = new Int32Array(edgeCount);
  const edgeParent = new Int32Array(edgeCount);
  const edgeFirst = new Uint8Array(edgeCount);
  const edgeStart = new Float64Array(edgeCount);
  const edgeEnd = new Float64Array(edgeCount);
  const edgeMaxEnd = new Float64Array(edgeCount);
  let running = -Infinity;
  for (let i = 0; i < edgeCount; i++) {
    const e = perm[i] ?? 0;
    edgeChild[i] = child[e] ?? 0;
    edgeParent[i] = parent[e] ?? 0;
    edgeFirst[i] = first[e] ?? 0;
    edgeStart[i] = start(e);
    edgeEnd[i] = end(e);
    running = Math.max(running, edgeEnd[i] ?? 0);
    edgeMaxEnd[i] = running;
  }

  return {
    count,
    times,
    order,
    sortedTimes,
    tMin: count > 0 ? (sortedTimes[0] ?? 0) : 0,
    tMax: count > 0 ? (sortedTimes[count - 1] ?? 0) : 0,
    refMask,
    edgeCount,
    edgeChild,
    edgeParent,
    edgeFirst,
    edgeStart,
    edgeEnd,
    edgeMaxEnd,
  };
}

/** Index of the first element of the sorted array that is >= `value` (or its length). */
function lowerBound(sorted: Float64Array, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Positions in `order` of the commits with a time in [t0, t1]. */
export function commitsBetween(data: TimelineData, t0: number, t1: number): { from: number; to: number } {
  const from = lowerBound(data.sortedTimes, t0);
  // First element > t1 is the first one >= t1 + epsilon; times are whole seconds, so +0.5 is enough.
  const to = Math.max(from, lowerBound(data.sortedTimes, t1 + 0.5));
  return { from, to };
}

/** Calls `visit` with the position of every edge whose time span touches [t0, t1]. */
export function edgesBetween(data: TimelineData, t0: number, t1: number, visit: (edge: number) => void): void {
  const first = lowerBound(data.edgeMaxEnd, t0);
  for (let e = first; e < data.edgeCount; e++) {
    if ((data.edgeStart[e] ?? 0) > t1) break;
    if ((data.edgeEnd[e] ?? 0) >= t0) visit(e);
  }
}
