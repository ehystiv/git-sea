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
/** Longest replay saved as a GIF: past this the file gets huge and slow to make. */
export const GIF_MAX_MS = 2 * 60_000;

/** The paces a replay can go at, in commits per second. */
export const SPEEDS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000] as const;
export type Speed = (typeof SPEEDS)[number];
/** The pace picked at first makes a replay about this long. */
const DEFAULT_MS = 30_000;

/** The slowest pace that replays `commits` in about `DEFAULT_MS` at most. */
export function defaultSpeed(commits: number): Speed {
  return SPEEDS.find((speed) => (commits / speed) * 1000 <= DEFAULT_MS) ?? SPEEDS[SPEEDS.length - 1];
}

/** How long it takes to bring in `commits` at `speed` commits per second. */
export function durationFor(commits: number, speed: number): number {
  return speed <= 0 ? 0 : (Math.max(0, commits) / speed) * 1000;
}

/** What a replay brings in: from which column (the newest is 0), and over how long. */
export interface ReplayPlan {
  /** The column of the commit the replay starts at; it and the older ones are there from the start. */
  start: number;
  durationMs: number;
}

/** A time as the replay's controls show it: "0:05", "1:40", "12:03". */
export function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** How long a replay lasts in all, the hold at the end included. */
export function replayLength(durationMs: number): number {
  return durationMs + HOLD_MS;
}

/**
 * The column (fractional) of the newest commit shown `ms` into a replay lasting `durationMs`.
 * Columns count from the newest commit of the history (0) to the oldest, so the replay walks them
 * downwards: from `start` (the commit it starts at, with all the history before it already
 * there) to 0 (the commit it ends at), at an even pace, so the camera glides between commits.
 */
export function frontierAt(start: number, ms: number, durationMs: number): number {
  const progress = durationMs <= 0 ? 1 : Math.min(1, Math.max(0, ms / durationMs));
  return Math.max(0, start) * (1 - progress);
}

/** The view that keeps the frontier at `FRONT` of the width, at the zoom and height of `view`. */
export function replayView(view: View, width: number, frontier: number): View {
  return { ...view, tx: width * FRONT + frontier * COLUMN_W * view.z };
}

/**
 * The newest column the frontier has reached: it and the older ones are drawn, the newer ones
 * not at all (a commit not reached yet would show its links before its node).
 */
export function revealedColumn(frontier: number): number {
  return Math.max(0, Math.ceil(frontier - 1e-9));
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
export function reachedAt(start: number, column: number, durationMs: number): number {
  return start <= 0 ? 0 : ((start - column) / start) * durationMs;
}

/**
 * Where a replayed commit's arrival starts: when its node begins to pop in. Its links appear with
 * the node (a commit is drawn only once reached), so the stages before would show them alone.
 */
const START = ARRIVAL.pop.at;

/** How long a commit keeps moving after the frontier reaches it: its pop, its ring. */
export const ARRIVAL_MS = ARRIVAL.ping.at + ARRIVAL.ping.ms - START;

/**
 * The arrival animation of the graph (see `ARRIVAL`) for the commits the frontier reached in the
 * last `ARRIVAL_MS`, in a history of `total` columns replayed from column `start`. Per column,
 * its place in the arrival (`order`, -1 for the commits that are settled or were there from the
 * start) and the time `elapsed` since the first of them, as `draw` reads them. Each commit starts
 * popping in when the frontier reaches it. The order counts in `ARRIVAL.stagger` steps, so
 * commits closer than a step start together. Null when no commit is moving.
 */
export function replayArrival(total: number, start: number, ms: number, durationMs: number): { order: Int16Array; fade: Int8Array; elapsed: number } | null {
  if (total <= 0 || start <= 0 || ms - ARRIVAL_MS >= durationMs) return null;
  const perColumn = durationMs / start;
  const frontier = frontierAt(start, ms, durationMs);
  // The oldest column still moving (the first one is there from the start), and the newest one reached.
  const oldest = Math.min(start - 1, perColumn <= 0 ? start - 1 : Math.floor(frontier + ARRIVAL_MS / perColumn));
  const newest = revealedColumn(frontier);
  if (newest > oldest) return null;
  const order = new Int16Array(total).fill(-1);
  const fade = new Int8Array(total);
  const base = reachedAt(start, oldest, durationMs);
  for (let column = newest; column <= oldest; column++) {
    order[column] = Math.min(32_000, Math.max(0, Math.round((reachedAt(start, column, durationMs) - base) / ARRIVAL.stagger)));
    fade[column] = 1;
  }
  return { order, fade, elapsed: ms - base + START };
}
