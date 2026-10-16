import type { GraphIndex } from "./GraphIndex";

/**
 * A short transition between two projections of the same history (a run opened or closed in the
 * topology view). Lanes do not change between projections, only columns, so a commit just slides
 * along x: from where it was to where it will be. Positions are in columns of the view after the
 * change; commits that appear or disappear (hidden in a node) fade in or out on the way.
 */
export interface Morph {
  /** The projection drawn during the transition: whichever of the two has every moving commit. */
  index: GraphIndex;
  from: Float64Array;
  to: Float64Array;
  /** 1 = fades in, -1 = fades out, 0 = stays; per column of `index`. */
  fade: Int8Array;
  /**
   * Arrivals only: per column, the place of a new commit in the order they enter (0 = the oldest,
   * which enters first, as history grows from its parent); -1 for commits that were already there.
   */
  order: Int16Array | null;
  /** How many commits enter. */
  arrivals: number;
}

/**
 * The transition from `before` to `after`. `shift` is how many columns the view moved when the
 * history was swapped (it keeps the anchor commit in place), so the motion starts from exactly
 * what was on screen. Null when there is nothing to animate.
 */
export function buildMorph(before: GraphIndex, after: GraphIndex, shift: number): Morph | null {
  if (before.length === 0 || after.length === 0 || before.length === after.length) return null;
  const opening = after.length > before.length;
  // Draw the finer projection: when opening, the new one; when closing, the old one.
  const index = opening ? after : before;
  const other = opening ? before : after;
  const count = index.length;
  const from = new Float64Array(count);
  const to = new Float64Array(count);
  const fade = new Int8Array(count);
  for (let r = 0; r < count; r++) {
    const id = index.commits[r]?.id ?? "";
    const there = other.indexOf(id);
    // Shown on its own in one projection but inside a node in the other.
    const hidden = there === null || other.aliases.has(id);
    const place = there ?? r;
    if (opening) {
      from[r] = place + shift;
      to[r] = r;
      fade[r] = hidden ? 1 : 0;
    } else {
      from[r] = r + shift;
      to[r] = place;
      fade[r] = hidden ? -1 : 0;
    }
  }
  return { index, from, to, fade, order: null, arrivals: 0 };
}

/** Most new commits that still get an entrance; beyond this (a big pull, a new filter) the history just changes. */
export const MAX_ARRIVALS = 20;

/**
 * The transition after a reload that brought new commits (a commit, a pull): the commits already
 * on screen slide to their new columns and the new ones fade in where they belong. Null when
 * nothing was added, or when so much changed that there is nothing to follow.
 */
export function buildArrival(before: GraphIndex, after: GraphIndex, shift: number): Morph | null {
  if (before.length === 0 || after.length === 0) return null;
  const count = after.length;
  const from = new Float64Array(count);
  const to = new Float64Array(count);
  const fade = new Int8Array(count);
  const order = new Int16Array(count).fill(-1);
  let added = 0;
  for (let r = count - 1; r >= 0; r--) {
    const id = after.commits[r]?.id ?? "";
    const there = before.indexOf(id);
    to[r] = r;
    if (there === null) {
      order[r] = added++;
      fade[r] = 1;
      from[r] = NaN;
    } else {
      from[r] = there + shift;
      // Shown on its own now, inside a node before: it comes out of the node.
      if (before.aliases.has(id)) fade[r] = 1;
    }
  }
  const removed = before.length - (count - added);
  if (added === 0 || added > MAX_ARRIVALS || removed > MAX_ARRIVALS) return null;
  // A new commit starts at its own column, but never past the commit after it, so it does not
  // cross the commits sliding out of its way.
  let next = Infinity;
  for (let r = count - 1; r >= 0; r--) {
    const place = from[r] ?? 0;
    next = Number.isNaN(place) ? Math.min(r + shift, next) : place;
    from[r] = next;
  }
  // Positions must stay sorted for the renderer's binary search, even if the walk reordered.
  for (let r = 1; r < count; r++) from[r] = Math.max(from[r] ?? 0, from[r - 1] ?? 0);
  return { index: after, from, to, fade, order, arrivals: added };
}

/**
 * Timeline of an arrival, in milliseconds: the commits slide aside, then each new one's link to
 * its parent is traced, the node pops in and a ring spreads out of it once. New commits follow
 * each other `stagger` apart.
 */
export const ARRIVAL = {
  slide: 280,
  stagger: 40,
  trace: { at: 160, ms: 180 },
  pop: { at: 300, ms: 240 },
  ping: { at: 460, ms: 600 },
} as const;

export function arrivalDuration(arrivals: number): number {
  return ARRIVAL.ping.at + ARRIVAL.ping.ms + Math.max(0, arrivals - 1) * ARRIVAL.stagger;
}

/** Progress (0..1, linear) of one stage for the new commit entering `order`-th. */
export function arrivalProgress(stage: { at: number; ms: number }, elapsed: number, order: number): number {
  return Math.min(1, Math.max(0, (elapsed - stage.at - order * ARRIVAL.stagger) / stage.ms));
}

/** Column positions at progress `t` (0..1, already eased). */
export function morphPositions(morph: Morph, t: number, out: Float64Array): Float64Array {
  for (let r = 0; r < morph.from.length; r++) {
    const a = morph.from[r] ?? 0;
    out[r] = a + ((morph.to[r] ?? 0) - a) * t;
  }
  return out;
}

/** First index whose position is >= `value` in positions sorted ascending. */
export function firstAtLeast(positions: Float64Array, value: number): number {
  let lo = 0;
  let hi = positions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((positions[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
