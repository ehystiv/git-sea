/** How long a clicked node bobs, in milliseconds. */
export const BOB_MS = 1100;
/** Deepest dip, in pixels at zoom 1 (scaled with the zoom). */
const DEPTH = 5;
/** Oscillations per second, and how fast they die out (seconds for the swing to fall to 1/e). */
const FREQUENCY = 2.6;
const DECAY = 0.26;

/**
 * A node pushed into the water and floating back up: a damped sine that starts downwards, so it
 * dips, rises a little past its place and settles with smaller and smaller swings. `dy` is
 * downwards in pixels at zoom 1; `scale` squeezes the node a little while it is under.
 */
export function bob(ms: number): { dy: number; scale: number } {
  if (ms <= 0 || ms >= BOB_MS) return { dy: 0, scale: 1 };
  const t = ms / 1000;
  // Eased in over the first instant, so the push does not start with a jump.
  const push = Math.min(1, ms / 40);
  // Faded out towards the end, so the last swing lands exactly on zero.
  const end = 1 - Math.max(0, (ms - BOB_MS * 0.7) / (BOB_MS * 0.3));
  const swing = Math.sin(2 * Math.PI * FREQUENCY * t) * Math.exp(-t / DECAY) * push * end;
  return { dy: DEPTH * swing, scale: 1 - 0.035 * Math.max(0, swing) };
}

/** How long the ripples around a clicked node last, in milliseconds. */
export const RIPPLE_MS = 1100;
const RINGS = 3;
/** Each ring starts this long after the one before. */
const RING_GAP_MS = 170;
const RING_MS = RIPPLE_MS - (RINGS - 1) * RING_GAP_MS;

/**
 * The rings spreading on the water from a clicked node, as fractions: `radius` of the node's size
 * (from just outside it to well past it) and `alpha`, fading as each ring grows. Rings that have
 * not started or have faded out are left out.
 */
export function ripples(ms: number): Array<{ radius: number; alpha: number; width: number }> {
  const out: Array<{ radius: number; alpha: number; width: number }> = [];
  for (let ring = 0; ring < RINGS; ring++) {
    const t = (ms - ring * RING_GAP_MS) / RING_MS;
    if (t <= 0 || t >= 1) continue;
    // Fast at first and slowing down, as a ring on water does.
    const spread = 1 - (1 - t) ** 3;
    out.push({ radius: 0.6 + spread * 1.1, alpha: 0.45 * (1 - t) ** 1.5 * (1 - ring * 0.25), width: 1.8 - t * 1.2 });
  }
  return out;
}
