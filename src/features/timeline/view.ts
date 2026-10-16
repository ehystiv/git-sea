import type { TimelineData } from "./layout";

/** Height of one row (a lane of the graph layout), and of the date axis at the top. */
export const ROW_H = 64;
export const AXIS_H = 30;
const TOP_PAD = 34;

/** Fastest zoom: one pixel per second. */
export const MAX_ZX = 1;
/** The zoom shown as "100%" in the controls: 100 px per day. */
export const BASE_ZX = 100 / 86400;
const DAY = 86400;

/** Where the timeline is: `t0` is the time at the left edge, `ty` the y of lane 0, `zx` pixels per second. */
export interface TimelineView {
  t0: number;
  ty: number;
  zx: number;
}

/** Zoomed out far enough to see the whole history in about three quarters of the width. */
export function minZoom(data: TimelineData, width: number): number {
  const span = Math.max(data.tMax - data.tMin, DAY);
  return Math.min(MAX_ZX, (width * 0.75) / span);
}

export function clampZoomX(zx: number, data: TimelineData, width: number): number {
  return Math.min(MAX_ZX, Math.max(minZoom(data, width), zx));
}

/** The y of lane 0 for a given scroll, kept so the lanes stay on screen. */
function clampTy(ty: number, lanes: number, height: number): number {
  const top = AXIS_H + TOP_PAD;
  const content = lanes * ROW_H;
  const available = height - AXIS_H - TOP_PAD;
  if (content <= available) return top;
  return Math.min(top, Math.max(height - (lanes - 0.5) * ROW_H - 8, ty));
}

/** Keeps the middle of the screen inside the history's time range and the lanes in view. */
export function clampTimelineView(view: TimelineView, data: TimelineData, lanes: number, width: number, height: number): TimelineView {
  const zx = clampZoomX(view.zx, data, width);
  const centre = Math.min(data.tMax, Math.max(data.tMin, view.t0 + width / 2 / zx));
  return { zx, t0: centre - width / 2 / zx, ty: clampTy(view.ty, lanes, height) };
}

/** Zooms in time by `factor` keeping the time under screen x `px` fixed. */
export function zoomAtX(view: TimelineView, factor: number, px: number, data: TimelineData, width: number): TimelineView {
  const zx = clampZoomX(view.zx * factor, data, width);
  const time = view.t0 + px / view.zx;
  return { ...view, zx, t0: time - px / zx };
}

export function screenX(view: TimelineView, time: number): number {
  return (time - view.t0) * view.zx;
}

export function timeAt(view: TimelineView, x: number): number {
  return view.t0 + x / view.zx;
}

export function laneY(view: TimelineView, lane: number): number {
  return view.ty + lane * ROW_H;
}

/** The whole history across the width, all lanes on screen. */
export function fitTimeline(data: TimelineData, lanes: number, width: number, height: number): TimelineView {
  const span = Math.max(data.tMax - data.tMin, DAY);
  const zx = clampZoomX((width - 160) / span, data, width);
  return clampTimelineView({ zx, t0: data.tMin - 80 / zx, ty: AXIS_H + TOP_PAD }, data, lanes, width, height);
}

/** The latest month (or the whole history when shorter), with the newest commit near the right edge. */
export function homeTimeline(data: TimelineData, lanes: number, width: number, height: number): TimelineView {
  const window = Math.min(Math.max(data.tMax - data.tMin, DAY), 30 * DAY);
  const zx = clampZoomX((width - 200) / window, data, width);
  return clampTimelineView({ zx, t0: data.tMax - (width - 100) / zx, ty: AXIS_H + TOP_PAD }, data, lanes, width, height);
}

/** The view with a commit (at `time`, on `lane`) in the middle of the screen, same zoom. */
export function centeredOnTimeline(
  view: TimelineView,
  time: number,
  lane: number,
  width: number,
  height: number,
): TimelineView {
  return { ...view, t0: time - width / 2 / view.zx, ty: height / 2 - lane * ROW_H };
}
