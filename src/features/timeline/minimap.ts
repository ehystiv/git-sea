import { BRANCH_COLORS } from "../graph/constants";
import type { GraphIndex } from "../graph/GraphIndex";
import { MINIMAP_H, MINIMAP_W, type Rect } from "../graph/minimapMath";
import type { MinimapModel } from "../graph/MinimapOverlay";
import type { Palette } from "../graph/palette";
import type { TimelineData } from "./layout";
import { AXIS_H, ROW_H, type TimelineView } from "./view";

const PAD = 8;
/** Largest distance between two lanes on the minimap, in pixels (keeps few lanes compact). */
const MAX_LANE_STEP = 14;
/** The viewport rectangle never gets smaller than this. */
const MIN_RECT = 6;
const DAY = 86_400;

/** How the timeline maps onto the minimap: time across, one band per lane down. */
export interface TimelineMinimapGeometry {
  tMin: number;
  /** Minimap pixels per second. */
  sx: number;
  /** Minimap pixels per lane. */
  laneStep: number;
  /** Minimap y of the top edge of lane 0. */
  top: number;
}

export function timelineMinimapGeometry(data: TimelineData, lanes: number, width = MINIMAP_W, height = MINIMAP_H): TimelineMinimapGeometry {
  const innerH = height - PAD * 2;
  const span = Math.max(data.tMax - data.tMin, DAY);
  const laneStep = Math.min(MAX_LANE_STEP, innerH / Math.max(1, lanes));
  return { tMin: data.tMin, sx: (width - PAD * 2) / span, laneStep, top: PAD + (innerH - lanes * laneStep) / 2 };
}

/** Minimap x of a time, and the reverse. */
export function minimapX(g: TimelineMinimapGeometry, time: number): number {
  return PAD + (time - g.tMin) * g.sx;
}

export function minimapTime(g: TimelineMinimapGeometry, x: number): number {
  return g.tMin + (x - PAD) / g.sx;
}

/** Minimap y of a lane position (lane `n` is centred at `n`), and the reverse. */
export function minimapY(g: TimelineMinimapGeometry, lane: number): number {
  return g.top + (lane + 0.5) * g.laneStep;
}

export function minimapLane(g: TimelineMinimapGeometry, y: number): number {
  return (y - g.top) / g.laneStep - 0.5;
}

/** The time span and the lanes the timeline shows, as a rectangle on the minimap. */
export function timelineViewportRect(g: TimelineMinimapGeometry, view: TimelineView, width: number, height: number): Rect {
  const x1 = minimapX(g, view.t0);
  const x2 = minimapX(g, view.t0 + width / view.zx);
  // Screen y of lane n's centre is ty + n * ROW_H; the lanes show between the axis and the bottom.
  const y1 = minimapY(g, (AXIS_H - view.ty) / ROW_H);
  const y2 = minimapY(g, (height - view.ty) / ROW_H);
  const w = Math.max(MIN_RECT, x2 - x1);
  const h = Math.max(MIN_RECT, y2 - y1);
  return { x: (x1 + x2) / 2 - w / 2, y: (y1 + y2) / 2 - h / 2, w, h };
}

/** The view with the time and lane under the minimap point in the middle of the screen, same zoom. */
export function timelineCenteredAt(g: TimelineMinimapGeometry, view: TimelineView, x: number, y: number, width: number, height: number): TimelineView {
  const time = minimapTime(g, x);
  const lane = minimapLane(g, y);
  return { ...view, t0: time - width / 2 / view.zx, ty: height / 2 - lane * ROW_H };
}

/**
 * Paints the history: one mark per pixel column and lane, in the colour of the newest commit
 * there, so a long history costs a few thousand rectangles whatever its size.
 */
export function drawTimelineMinimap(ctx: CanvasRenderingContext2D, index: GraphIndex, data: TimelineData, g: TimelineMinimapGeometry, palette: Palette, width = MINIMAP_W, height = MINIMAP_H): void {
  ctx.clearRect(0, 0, width, height);
  const lanes = index.maxLane + 1;
  if (data.count === 0) return;
  const cells = new Int16Array(width * lanes).fill(-1);
  // Oldest first, so a newer commit in the same cell paints over an older one.
  for (let k = 0; k < data.count; k++) {
    const column = data.order[k] ?? 0;
    const row = index.rows[column];
    if (!row) continue;
    const px = Math.floor(minimapX(g, data.times[column] ?? 0));
    if (px < 0 || px >= width) continue;
    cells[row.lane * width + px] = row.color % BRANCH_COLORS;
  }
  const thickness = Math.max(1.5, Math.min(g.laneStep * 0.6, 5));
  for (let lane = 0; lane < lanes; lane++) {
    const y = minimapY(g, lane) - thickness / 2;
    // A faint guide per lane, as in the timeline itself.
    ctx.fillStyle = palette.dot;
    ctx.fillRect(PAD, minimapY(g, lane) - 0.25, width - PAD * 2, 0.5);
    for (let px = 0; px < width; px++) {
      const color = cells[lane * width + px] ?? -1;
      if (color < 0) continue;
      ctx.fillStyle = palette.branch[color] ?? palette.text3;
      ctx.fillRect(px, y, 1.5, thickness);
    }
  }
}

/** The timeline on the minimap; `data` is the controller's current timeline (rebuilt with the index). */
export function timelineMinimap(index: GraphIndex, data: () => TimelineData): MinimapModel<TimelineView> {
  const geometry = () => timelineMinimapGeometry(data(), index.maxLane + 1);
  return {
    version: () => [data(), index.maxLane],
    paint: (ctx, palette) => drawTimelineMinimap(ctx, index, data(), geometry(), palette),
    viewport: (view, width, height) => (data().count === 0 ? null : timelineViewportRect(geometry(), view, width, height)),
    centeredAt: (view, x, y, width, height) => timelineCenteredAt(geometry(), view, x, y, width, height),
  };
}
