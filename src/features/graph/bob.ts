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
