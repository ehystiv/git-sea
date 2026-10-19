import { COLUMN_W } from "../graph/constants";
import type { View } from "../graph/draw";

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

/** Screen x past which nothing is drawn: just right of the frontier's node. */
export function frontierX(view: View, frontier: number): number {
  return -frontier * COLUMN_W * view.z + view.tx + COLUMN_W * view.z * 0.6;
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
