import { BRANCH_COLORS, COLUMN_W, LANE_H } from "./constants";
import { withAlpha, type View } from "./draw";
import type { GraphIndex } from "./GraphIndex";
import type { MinimapModel } from "./MinimapOverlay";
import type { Palette } from "./palette";

export const MINIMAP_W = 220;
export const MINIMAP_H = 96;
const PAD = 8;
/** Largest distance between two lanes on the minimap, in pixels (keeps short histories compact). */
const MAX_LANE_STEP = 14;
/** The viewport rectangle never gets smaller than this, otherwise it would vanish on long histories. */
const MIN_RECT = 6;

/** How the whole graph maps onto the minimap. World x = -column * COLUMN_W, world y = lane * LANE_H. */
export interface MinimapGeometry {
  /** Minimap pixels per world unit. */
  sx: number;
  sy: number;
  /** Minimap x of world x = 0, the centre of the newest column (half a column inside the right padding). */
  right: number;
  /** Minimap y of world y = -LANE_H / 2 (the top edge of lane 0). */
  top: number;
}

export function minimapGeometry(index: GraphIndex, width = MINIMAP_W, height = MINIMAP_H): MinimapGeometry {
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  const columns = Math.max(1, index.length);
  const lanes = index.maxLane + 1;
  const laneStep = Math.min(MAX_LANE_STEP, innerH / lanes);
  const sy = laneStep / LANE_H;
  // Short histories keep the same scale on both axes; long ones are squeezed to fit the width.
  const sx = Math.min(innerW / (columns * COLUMN_W), sy);
  return {
    sx,
    sy,
    right: width - PAD - (COLUMN_W / 2) * sx,
    top: PAD + (innerH - lanes * laneStep) / 2,
  };
}

export function worldToMinimap(g: MinimapGeometry, wx: number, wy: number): { x: number; y: number } {
  return { x: g.right + wx * g.sx, y: g.top + (wy + LANE_H / 2) * g.sy };
}

export function minimapToWorld(g: MinimapGeometry, x: number, y: number): { x: number; y: number } {
  return { x: (x - g.right) / g.sx, y: (y - g.top) / g.sy - LANE_H / 2 };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the graph the main canvas shows, as a rectangle on the minimap. */
export function viewportRect(g: MinimapGeometry, view: View, width: number, height: number): Rect {
  const a = worldToMinimap(g, -view.tx / view.z, -view.ty / view.z);
  const b = worldToMinimap(g, (width - view.tx) / view.z, (height - view.ty) / view.z);
  const w = Math.max(MIN_RECT, b.x - a.x);
  const h = Math.max(MIN_RECT, b.y - a.y);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The view that shows the world point under the minimap point (x, y) in the middle of the screen. */
export function viewCenteredAtMinimap(
  g: MinimapGeometry,
  view: View,
  x: number,
  y: number,
  width: number,
  height: number,
): View {
  const world = minimapToWorld(g, x, y);
  return { z: view.z, tx: width / 2 - world.x * view.z, ty: height / 2 - world.y * view.z };
}

/**
 * Paints the whole history into `ctx` (the minimap's static layer). Commits are binned by pixel
 * column and lane so a 100k-commit history costs a few thousand rectangles, not one per commit.
 */
export function drawMinimapGraph(
  ctx: CanvasRenderingContext2D,
  index: GraphIndex,
  g: MinimapGeometry,
  palette: Palette,
  width = MINIMAP_W,
  height = MINIMAP_H,
): void {
  ctx.clearRect(0, 0, width, height);
  const count = index.length;
  if (count === 0) return;

  const columnPx = COLUMN_W * g.sx;
  const laneStep = LANE_H * g.sy;

  if (columnPx >= 3) {
    // Few enough commits to tell them apart: edges as thin lines, commits as squares.
    ctx.lineWidth = 1;
    for (let c = 0; c < BRANCH_COLORS; c++) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < count; i++) {
        const row = index.rows[i];
        if (!row) continue;
        const x = worldToMinimap(g, -i * COLUMN_W, 0).x;
        for (const edge of row.edges) {
          if (edge.color % BRANCH_COLORS !== c) continue;
          const y1 = worldToMinimap(g, 0, edge.fromLane * LANE_H).y;
          const y2 = worldToMinimap(g, 0, edge.toLane * LANE_H).y;
          if (edge.kind === "MergeIn") {
            ctx.moveTo(x + columnPx / 2, y1);
            ctx.lineTo(x, y2);
          } else if (edge.kind === "ForkOut") {
            ctx.moveTo(x, y1);
            ctx.lineTo(x - columnPx / 2, y2);
          } else {
            ctx.moveTo(x + columnPx / 2, y1);
            ctx.lineTo(x - columnPx / 2, y2);
          }
          any = true;
        }
      }
      if (any) {
        ctx.strokeStyle = withAlpha(palette.branch[c] ?? palette.text3, 0.7);
        ctx.stroke();
      }
    }
    const size = Math.max(2, Math.min(columnPx * 0.6, laneStep * 0.7, 6));
    for (let i = 0; i < count; i++) {
      const row = index.rows[i];
      if (!row) continue;
      const p = worldToMinimap(g, -i * COLUMN_W, row.lane * LANE_H);
      ctx.fillStyle = palette.branch[row.color % BRANCH_COLORS] ?? palette.text3;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    return;
  }

  // Many commits per pixel column: one mark per (pixel column, lane), coloured by the newest commit.
  const lanes = index.maxLane + 1;
  const cells = new Int16Array(width * lanes).fill(-1);
  for (let i = count - 1; i >= 0; i--) {
    const row = index.rows[i];
    if (!row) continue;
    const px = Math.floor(worldToMinimap(g, -i * COLUMN_W, 0).x);
    if (px < 0 || px >= width) continue;
    cells[row.lane * width + px] = row.color % BRANCH_COLORS;
  }
  const thickness = Math.max(1, Math.min(laneStep * 0.7, 4));
  for (let lane = 0; lane < lanes; lane++) {
    const y = worldToMinimap(g, 0, lane * LANE_H).y - thickness / 2;
    for (let px = 0; px < width; px++) {
      const color = cells[lane * width + px] ?? -1;
      if (color < 0) continue;
      ctx.fillStyle = palette.branch[color] ?? palette.text3;
      ctx.fillRect(px, y, 1, thickness);
    }
  }
}

/** The graph on the minimap: the geometry follows the index as it grows or is replaced. */
export function graphMinimap(index: GraphIndex): MinimapModel<View> {
  let geometry = minimapGeometry(index);
  let geometryFor: readonly unknown[] = [];
  const current = () => {
    const version = [index.commits, index.length, index.maxLane];
    if (!version.every((v, i) => v === geometryFor[i])) {
      geometry = minimapGeometry(index);
      geometryFor = version;
    }
    return geometry;
  };
  return {
    version: () => [index.commits, index.length, index.maxLane],
    paint: (ctx, palette) => drawMinimapGraph(ctx, index, current(), palette),
    viewport: (view, width, height) => (index.length === 0 ? null : viewportRect(current(), view, width, height)),
    centeredAt: (view, x, y, width, height) => viewCenteredAtMinimap(current(), view, x, y, width, height),
  };
}
