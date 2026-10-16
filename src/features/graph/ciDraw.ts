import type { CiRunStatus, CiWorkflow } from "../../lib/bindings";
import { summaryStatus, type CiMarker, type CiMarkers, type CiSlot } from "../ci/markers";
import { COLUMN_W, HALF, LANE_H, LOD_TILE } from "./constants";
import { DIM_ALPHA, type Emphasis } from "./emphasis";
import type { GraphIndex } from "./GraphIndex";
import type { Palette } from "./palette";

/** CI markers to draw on the links: real runs filled, hypothetical starts as dashed outlines. */
export interface CiScene {
  markers: CiMarkers;
  workflows: CiWorkflow[];
}

interface ViewLike {
  tx: number;
  ty: number;
  z: number;
}

interface Spot {
  slot: CiSlot;
  x: number;
  y: number;
  radius: number;
}

/**
 * Where a commit's markers sit. A push (or a run) is on the link to the first parent, halfway to
 * the next column; a merge is halfway along the curve that brings the merged branch in.
 */
function spots(index: GraphIndex, view: ViewLike, marker: CiMarker, r: number): Spot[] {
  const row = index.rows[r];
  if (!row) return [];
  const z = view.z;
  const cx = -r * COLUMN_W * z + view.tx;
  const cy = row.lane * LANE_H * z + view.ty;
  // Bigger than the dots moving along the links, so they are not mistaken for them.
  const radius = Math.max(6, 11 * z);
  const out: Spot[] = [];
  if (marker.runs.length > 0 || marker.push.length > 0) {
    out.push({ slot: "push", x: cx - (COLUMN_W / 2) * z, y: cy, radius });
  }
  if (marker.merge.length > 0) {
    const fork = row.edges.find((e) => e.kind === "ForkOut");
    if (fork) {
      // The midpoint of the bezier drawn by `drawEdges` for a ForkOut edge.
      const toY = fork.toLane * LANE_H * z + view.ty;
      out.push({ slot: "merge", x: cx - ((HALF + COLUMN_W / 2) / 2) * z, y: (cy + toY) / 2, radius });
    }
  }
  return out;
}

/** The marker under a screen point, or null. Markers are only drawn from the tile zoom level up. */
export function hitCi(index: GraphIndex, view: ViewLike, ci: CiScene | null, px: number, py: number): { id: string; slot: CiSlot; marker: CiMarker } | null {
  if (!ci || ci.markers.size === 0 || view.z < LOD_TILE) return null;
  const around = Math.round(-(px - view.tx) / view.z / COLUMN_W);
  for (let r = around - 1; r <= around + 1; r++) {
    const commit = index.commits[r];
    const marker = commit ? ci.markers.get(commit.id) : undefined;
    if (!commit || !marker) continue;
    for (const spot of spots(index, view, marker, r)) {
      if (Math.hypot(px - spot.x, py - spot.y) <= spot.radius + 3) return { id: commit.id, slot: spot.slot, marker };
    }
  }
  return null;
}

interface CiDrawScene {
  index: GraphIndex;
  view: ViewLike;
  palette: Palette;
  width: number;
  height: number;
  emphasis: Emphasis | null;
  ci: CiScene | null;
}

export function drawCi(ctx: CanvasRenderingContext2D, scene: CiDrawScene, first: number, last: number): void {
  const { ci, index, view, palette, width, height } = scene;
  if (!ci || ci.markers.size === 0 || view.z < LOD_TILE) return;
  const nodes = scene.emphasis?.nodes ?? null;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // One column more on the right: its push marker reaches into this one's space.
  for (let r = Math.max(0, first - 1); r <= last; r++) {
    const commit = index.commits[r];
    const marker = commit ? ci.markers.get(commit.id) : undefined;
    if (!marker) continue;
    ctx.globalAlpha = nodes && !nodes[r] ? DIM_ALPHA : 1;
    for (const spot of spots(index, view, marker, r)) {
      if (spot.x < -spot.radius || spot.x > width + spot.radius || spot.y < -spot.radius || spot.y > height + spot.radius) continue;
      const status = spot.slot === "push" ? summaryStatus(marker.runs) : null;
      if (status) drawRun(ctx, palette, spot, status);
      else drawHypothetical(ctx, palette, spot);
    }
  }
  ctx.restore();
}

/** A dashed ring with a "play" mark: this is where a workflow would start. */
function drawHypothetical(ctx: CanvasRenderingContext2D, palette: Palette, { x, y, radius }: Spot): void {
  const k = radius / 8;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = palette.canvas;
  ctx.fill();
  ctx.setLineDash([Math.max(1.5, 2.6 * k), Math.max(1.5, 2 * k)]);
  ctx.lineWidth = Math.max(1, 1.4 * k);
  ctx.strokeStyle = palette.text2;
  ctx.stroke();
  ctx.setLineDash([]);
  const s = radius * 0.4;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y - s);
  ctx.lineTo(x + s * 0.95, y);
  ctx.lineTo(x - s * 0.55, y + s);
  ctx.closePath();
  ctx.lineWidth = Math.max(1, 1.3 * k);
  ctx.stroke();
}

/** A filled disc in the colour of the run's outcome, with its symbol. */
function drawRun(ctx: CanvasRenderingContext2D, palette: Palette, { x, y, radius }: Spot, status: CiRunStatus): void {
  const fill =
    status === "Success" ? palette.success : status === "Failure" ? palette.failure : status === "Running" || status === "Queued" ? palette.pending : palette.text3;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, radius * 0.2);
  ctx.strokeStyle = palette.canvas;
  ctx.stroke();

  const s = radius * 0.42;
  ctx.strokeStyle = palette.onStatus;
  ctx.fillStyle = palette.onStatus;
  ctx.lineWidth = Math.max(1.2, radius * 0.22);
  ctx.beginPath();
  switch (status) {
    case "Success":
      ctx.moveTo(x - s, y + s * 0.05);
      ctx.lineTo(x - s * 0.25, y + s * 0.75);
      ctx.lineTo(x + s, y - s * 0.7);
      ctx.stroke();
      break;
    case "Failure":
      ctx.moveTo(x - s * 0.8, y - s * 0.8);
      ctx.lineTo(x + s * 0.8, y + s * 0.8);
      ctx.moveTo(x + s * 0.8, y - s * 0.8);
      ctx.lineTo(x - s * 0.8, y + s * 0.8);
      ctx.stroke();
      break;
    case "Running":
      ctx.arc(x, y, s, -Math.PI / 2, Math.PI);
      ctx.stroke();
      break;
    case "Queued":
      ctx.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "Cancelled":
      ctx.moveTo(x - s * 0.75, y + s * 0.75);
      ctx.lineTo(x + s * 0.75, y - s * 0.75);
      ctx.stroke();
      break;
    case "Skipped":
    case "Neutral":
      ctx.moveTo(x - s * 0.8, y);
      ctx.lineTo(x + s * 0.8, y);
      ctx.stroke();
      break;
  }
}
