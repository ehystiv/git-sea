import { COLUMN_W, HALF, LANE_H, MAX_ZOOM, MIN_ZOOM } from "./constants";
import type { View } from "./draw";
import type { GraphIndex } from "./GraphIndex";

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Keeps the centre of the viewport inside the graph's bounding box. */
export function clampView(view: View, width: number, height: number, index: GraphIndex): View {
  const z = clampZoom(view.z);
  const xMin = -(Math.max(index.length, 1) - 1) * COLUMN_W - COLUMN_W / 2;
  const xMax = COLUMN_W / 2;
  const yMin = -LANE_H / 2;
  const yMax = index.maxLane * LANE_H + LANE_H / 2;
  const tx = Math.min(width / 2 - xMin * z, Math.max(width / 2 - xMax * z, view.tx));
  const ty = Math.min(height / 2 - yMin * z, Math.max(height / 2 - yMax * z, view.ty));
  return { tx, ty, z };
}

/** Zooms by `factor` keeping the world point under the screen point (px, py) fixed. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const z = clampZoom(view.z * factor);
  const k = z / view.z;
  return { z, tx: px - (px - view.tx) * k, ty: py - (py - view.ty) * k };
}

/** View with column `i` in the middle of the screen. */
export function centeredOn(index: GraphIndex, i: number, z: number, width: number, height: number): View {
  const lane = index.rows[i]?.lane ?? 0;
  return { z, tx: width / 2 + i * COLUMN_W * z, ty: height / 2 - lane * LANE_H * z };
}

/** Newest commit (HEAD) near the right edge, at full size. */
export function homeView(index: GraphIndex, width: number, height: number): View {
  const lane = index.rows[0]?.lane ?? 0;
  return { z: 1, tx: width - 140, ty: height / 2 - lane * LANE_H };
}

/** Largest number of commits "Adatta" tries to fit; longer histories show their recent end. */
export const FIT_COLUMNS = 120;

/** Fits the newest commits (all of them for short histories) and every lane they use. */
export function fitView(index: GraphIndex, width: number, height: number): View {
  const columns = Math.max(1, Math.min(index.length, FIT_COLUMNS));
  let maxLane = 0;
  for (let i = 0; i < columns; i++) {
    const row = index.rows[i];
    if (row) maxLane = Math.max(maxLane, row.lane);
  }
  const worldW = columns * COLUMN_W + HALF * 4;
  const worldH = (maxLane + 1) * LANE_H + HALF * 6;
  const z = clampZoom(Math.min(1, (width - 80) / worldW, (height - 80) / worldH));
  const centerX = -((columns - 1) * COLUMN_W) / 2;
  const centerY = (maxLane * LANE_H) / 2;
  return { z, tx: width / 2 - centerX * z, ty: height / 2 - centerY * z };
}

/** A commit and where it is on screen, remembered while the data under the view is replaced. */
export interface ViewAnchor {
  id: string;
  /** Column of the commit before the replacement. */
  column: number;
  screenX: number;
  screenY: number;
}

/** Columns this close to the newest commit count as "following the tip". */
const TIP_COLUMNS = 1;

/** The commit at the centre of the screen, with its position on screen. */
export function anchorAtCentre(index: GraphIndex, view: View, width: number): ViewAnchor | null {
  if (index.length === 0) return null;
  const column = Math.min(index.length - 1, Math.max(0, Math.round(-((width / 2 - view.tx) / view.z) / COLUMN_W)));
  const commit = index.commits[column];
  const row = index.rows[column];
  if (!commit || !row) return null;
  return {
    id: commit.id,
    column,
    screenX: -column * COLUMN_W * view.z + view.tx,
    screenY: row.lane * LANE_H * view.z + view.ty,
  };
}

/**
 * The view that puts the anchor commit back where it was on screen once the history changed
 * (new commits shift every column). When the user was looking at the newest commits the view is
 * left alone instead, so new commits show up where they were looking. If the commit is gone, the
 * view is left alone too.
 */
export function viewAfterReplace(index: GraphIndex, view: View, anchor: ViewAnchor | null): View {
  if (!anchor || anchor.column <= TIP_COLUMNS) return view;
  const column = index.indexOf(anchor.id);
  if (column === null) return view;
  const lane = index.rows[column]?.lane ?? 0;
  return {
    z: view.z,
    tx: anchor.screenX + column * COLUMN_W * view.z,
    ty: anchor.screenY - lane * LANE_H * view.z,
  };
}
