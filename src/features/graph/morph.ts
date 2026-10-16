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
  return { index, from, to, fade };
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
