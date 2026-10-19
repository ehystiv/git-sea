import { COLUMN_W } from "../graph/constants";
import type { View } from "../graph/draw";
import { ARRIVAL } from "../graph/morph";

/** The whole history stays on screen this long at the end, before the replay stops. */
export const HOLD_MS = 1500;
/** Where the newest commit shown sits, as a share of the width: the history grows towards the right. */
export const FRONT = 0.78;
/** Frames per second of an exported GIF; more would make it much bigger. */
export const GIF_FPS = 15;
/** Longest side of an exported GIF, in pixels. */
export const GIF_MAX_WIDTH = 960;

/** How long a replay lasts in all, the hold at the end included. */
export function replayLength(durationMs: number): number {
  return durationMs + HOLD_MS;
}

/**
 * How many commits are shown `ms` into a replay of `total` commits lasting `durationMs`: from one
 * to all of them, at an even pace (fractional, so the camera glides between commits).
 */
export function revealedAt(total: number, ms: number, durationMs: number): number {
  if (total <= 0) return 0;
  const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, ms / durationMs));
  return 1 + (total - 1) * progress;
}

/**
 * The column (fractional) the newest commit shown sits at. Columns count from the newest commit
 * of the history (0) to the oldest (total - 1), so the replay walks them downwards.
 */
export function frontierColumn(total: number, revealed: number): number {
  return Math.max(0, total - revealed);
}

/** The view that keeps the frontier at `FRONT` of the width, at the zoom and height of `view`. */
export function replayView(view: View, width: number, frontier: number): View {
  return { ...view, tx: width * FRONT + frontier * COLUMN_W * view.z };
}

/** How far past the frontier the graph is drawn, in columns: just right of the frontier's node. */
export const EDGE = 0.6;

/** Screen x past which nothing is drawn. */
export function frontierX(view: View, frontier: number): number {
  return -frontier * COLUMN_W * view.z + view.tx + COLUMN_W * view.z * EDGE;
}

/** How many frames a GIF of a replay lasting `lengthMs` has. */
export function gifFrames(lengthMs: number): number {
  return Math.max(1, Math.ceil((lengthMs / 1000) * GIF_FPS));
}

/** The size a GIF of a `width` × `height` view is drawn at. */
export function gifSize(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, GIF_MAX_WIDTH / Math.max(1, width));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** When the frontier reaches column `column`, in milliseconds from the start of the replay. */
export function reachedAt(total: number, column: number, durationMs: number): number {
  return total <= 1 ? 0 : ((total - 1 - column) / (total - 1)) * durationMs;
}

/** How long a commit keeps moving after the frontier reaches it: its link, its pop, its ring. */
export const ARRIVAL_MS = ARRIVAL.ping.at + ARRIVAL.ping.ms - ARRIVAL.trace.at;

/**
 * The arrival animation of the graph (see `ARRIVAL`) for the commits the frontier reached in the
 * last `ARRIVAL_MS`, and for the ones not reached yet that are still drawn (between the frontier
 * and the edge), which wait unseen. Those further on are cut away anyway: marking them would
 * hide their links, which cross the whole view when their parent is far behind. Per column, its place in the
 * arrival (`order`, -1 for the commits that are settled) and the time `elapsed` since the first
 * of them, as `draw` reads them. Each commit starts tracing its link when the frontier reaches it.
 * The order counts in `ARRIVAL.stagger` steps, so commits closer than a step start together.
 * Null when no commit is moving.
 */
export function replayArrival(total: number, ms: number, durationMs: number): { order: Int16Array; fade: Int8Array; elapsed: number } | null {
  if (total <= 0 || ms - ARRIVAL_MS >= durationMs) return null;
  const perColumn = total <= 1 ? 0 : durationMs / (total - 1);
  const frontier = frontierColumn(total, revealedAt(total, ms, durationMs));
  // The oldest column still moving, and the newest one drawn past the frontier.
  const oldest = perColumn <= 0 ? total - 1 : Math.min(total - 1, Math.floor(frontier + ARRIVAL_MS / perColumn));
  const newest = Math.max(0, Math.floor(frontier - EDGE) + 1);
  const order = new Int16Array(total).fill(-1);
  const fade = new Int8Array(total);
  const base = reachedAt(total, oldest, durationMs);
  for (let column = newest; column <= oldest; column++) {
    order[column] = Math.min(32_000, Math.max(0, Math.round((reachedAt(total, column, durationMs) - base) / ARRIVAL.stagger)));
    fade[column] = 1;
  }
  return { order, fade, elapsed: ms - base + ARRIVAL.trace.at };
}
