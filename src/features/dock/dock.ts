/** A corner of the view a floating widget (zoom controls, minimap) rests in. */
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const CORNERS: readonly Corner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The part of the view widgets live in: everything but what floats over its right side. */
export interface DockArea {
  width: number;
  height: number;
  /** Pixels covered on the right (the details panel). */
  insetRight: number;
  /** Pixels kept free at the top (the timeline's date axis). */
  insetTop: number;
  /** Distance between a widget and the edges. */
  margin: number;
}

interface Rect extends Point, Size {}

/** Top-left position of a widget of `size` resting in `corner`. */
export function cornerPosition(corner: Corner, size: Size, area: DockArea): Point {
  const right = corner.endsWith("right");
  const bottom = corner.startsWith("bottom");
  const left = right ? area.width - area.insetRight - area.margin - size.width : area.margin;
  const top = bottom ? area.height - area.margin - size.height : area.insetTop + area.margin;
  // A view too small for the widget keeps it at the top-left margin rather than off screen.
  return { x: Math.max(area.margin, left), y: Math.max(area.margin, top) };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The corners sorted by how close the centre of a widget at `at` is to where it would rest there. */
export function cornersByDistance(at: Point, size: Size, area: DockArea): Corner[] {
  const distance = (corner: Corner) => {
    const p = cornerPosition(corner, size, area);
    return Math.hypot(p.x - at.x, p.y - at.y);
  };
  return [...CORNERS].sort((a, b) => distance(a) - distance(b));
}

export interface DockItem {
  id: string;
  size: Size;
  /** Where the user put it. */
  corner: Corner;
}

/**
 * Where each widget rests, in the order given (the first gets its corner for sure). A widget
 * whose corner is taken, or that would overlap one already placed (two widgets side by side in a
 * narrow view), goes to the nearest corner where it fits; if none is free of overlap, to the one
 * where it overlaps least.
 */
export function layoutDock(items: readonly DockItem[], area: DockArea): Map<string, { corner: Corner; at: Point }> {
  const placed: Rect[] = [];
  const out = new Map<string, { corner: Corner; at: Point }>();
  for (const item of items) {
    const wanted = cornerPosition(item.corner, item.size, area);
    const candidates = cornersByDistance(wanted, item.size, area);
    let best: { corner: Corner; at: Point; cost: number } | null = null;
    for (const corner of candidates) {
      const at = cornerPosition(corner, item.size, area);
      const rect = { ...at, ...item.size };
      const cost = placed.reduce((sum, other) => sum + overlap(rect, other), 0);
      if (best === null || cost < best.cost) best = { corner, at, cost };
      if (cost === 0) break;
    }
    if (!best) continue;
    placed.push({ ...best.at, ...item.size });
    out.set(item.id, { corner: best.corner, at: best.at });
  }
  return out;
}

/**
 * The corner a dropped widget goes to: the nearest one that does not overlap where the others
 * rest. `others` are the rectangles of the widgets left where they are.
 */
export function dropCorner(at: Point, size: Size, area: DockArea, others: ReadonlyArray<Rect>): Corner {
  const candidates = cornersByDistance(at, size, area);
  for (const corner of candidates) {
    const rect = { ...cornerPosition(corner, size, area), ...size };
    if (others.every((other) => overlap(rect, other) === 0)) return corner;
  }
  return candidates[0] ?? "bottom-right";
}

/** A position and its velocity (pixels per second) along one axis. */
export interface SpringState {
  x: number;
  v: number;
}

/** Underdamped: the widget overshoots its corner a little and settles back, a soft bounce. */
export const BOUNCE = { stiffness: 420, damping: 22 } as const;

/** One step of a damped spring pulling towards `target`, `dt` in seconds (semi-implicit Euler). */
export function springStep(state: SpringState, target: number, dt: number, spring: { stiffness: number; damping: number } = BOUNCE): SpringState {
  const force = -spring.stiffness * (state.x - target) - spring.damping * state.v;
  const v = state.v + force * dt;
  return { x: state.x + v * dt, v };
}

/** Fastest throw, in pixels per second: a flick sends the widget off quickly, not off screen. */
export const MAX_THROW = 2400;

/**
 * Keeps a moving widget between `min` and `max` (the view's edges): one that reaches an edge
 * bounces off it, losing most of its speed.
 */
export function bounceOffEdges(state: SpringState, min: number, max: number): SpringState {
  if (state.x < min) return { x: min, v: Math.abs(state.v) * 0.35 };
  if (state.x > max) return { x: max, v: -Math.abs(state.v) * 0.35 };
  return state;
}

/** Close enough to stop animating: under half a pixel away and nearly still. */
export function springAtRest(state: SpringState, target: number): boolean {
  return Math.abs(state.x - target) < 0.5 && Math.abs(state.v) < 8;
}
