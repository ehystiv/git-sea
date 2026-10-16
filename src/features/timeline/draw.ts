import type { RefLabel } from "../../lib/bindings";
import { BRANCH_COLORS } from "../graph/constants";
import { describeCommit } from "../graph/describe";
import { DIM_ALPHA, emphasisFits, type Emphasis } from "../graph/emphasis";
import { fitText, withAlpha } from "../graph/draw";
import { drawFlow, FlowLinks } from "../graph/flow";
import type { GraphIndex } from "../graph/GraphIndex";
import type { Palette } from "../graph/palette";
import { commitsBetween, edgesBetween, type TimelineData } from "./layout";
import { timeTicks } from "./ticks";
import { AXIS_H, laneY, ROW_H, screenX, type TimelineView } from "./view";

type Ctx = CanvasRenderingContext2D;

export interface TimelineScene {
  width: number;
  height: number;
  dpr: number;
  view: TimelineView;
  index: GraphIndex;
  data: TimelineData;
  palette: Palette;
  selected: number | null;
  hovered: number | null;
  /** Animation time in milliseconds; null when the dots on the links are switched off. */
  flowTime: number | null;
  /** Commits to keep bright while the rest fades (search, ancestors); null for none. */
  emphasis: Emphasis | null;
}

/** Pixels per hour from which commits are drawn as outlined nodes with labels. */
const LOD_NODE = 30;
/** Pixels per hour from which commits are drawn as small squares rather than dots. */
const LOD_SQUARE = 4;
const NODE = 14;
const KIND_ORDER: Record<RefLabel["kind"], number> = { Head: 0, Branch: 1, Remote: 2, Tag: 3 };
/** Above this many commits on screen, edges that cannot be told apart from the lane are skipped. */
const DENSE = 20_000;
/** Dots travelling along the links: pixels per second and pixels between two of them. */
const FLOW_SPEED = 48;
const FLOW_SPACING = 96;
/** Dots appear from this many pixels per hour (24 px per day), which includes the opening view. */
const FLOW_MIN_PER_HOUR = 1;
const MAX_DEDUPE_LANES = 1000;

/** Size in pixels of a commit's marker at this zoom. */
export function markerSize(view: TimelineView): number {
  const perHour = view.zx * 3600;
  return perHour >= LOD_NODE ? NODE : perHour >= LOD_SQUARE ? 8 : 3;
}

/** Draws a frame. Returns true when something in it moves, so the caller knows to keep animating. */
export function drawTimeline(ctx: Ctx, input: TimelineScene): boolean {
  const scene = emphasisFits(input.emphasis, input.index) ? input : { ...input, emphasis: null };
  const { width, height, dpr, view, palette } = scene;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);

  const t0 = view.t0;
  const t1 = view.t0 + width / view.zx;
  const ticks = timeTicks(t0, t1, view.zx);

  drawGrid(ctx, scene, ticks.map((t) => ({ x: screenX(view, t.time), major: t.major })));
  let moving = false;
  if (scene.data.count > 0) {
    const margin = 60 / view.zx;
    // Dots only when zoomed in enough; further out they would just be noise.
    const links = scene.flowTime !== null && view.zx * 3600 >= FLOW_MIN_PER_HOUR ? new FlowLinks() : null;
    drawEdges(ctx, scene, t0 - margin, t1 + margin, links);
    if (links && scene.flowTime !== null) {
      moving =
        drawFlow(ctx, links, {
          time: scene.flowTime,
          anchor: -view.t0 * view.zx,
          spacing: FLOW_SPACING,
          speed: FLOW_SPEED,
          radius: 2.6,
          width,
          height,
          palette,
        }) > 0;
    }
    drawNodes(ctx, scene, t0 - margin, t1 + margin);
  }
  drawAxis(ctx, scene, ticks);
  return moving;
}

function drawGrid(ctx: Ctx, scene: TimelineScene, xs: Array<{ x: number; major: boolean }>): void {
  const { width, height, view, palette, index } = scene;
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.dot;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  for (const { x, major } of xs) {
    if (major) continue;
    ctx.moveTo(Math.round(x) + 0.5, AXIS_H);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  for (const { x, major } of xs) {
    if (!major) continue;
    ctx.moveTo(Math.round(x) + 0.5, AXIS_H);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  ctx.stroke();

  // One faint guide per row.
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let lane = 0; lane <= index.maxLane; lane++) {
    const y = Math.round(laneY(view, lane)) + 0.5;
    if (y < AXIS_H || y > height) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEdges(ctx: Ctx, scene: TimelineScene, tFrom: number, tTo: number, links: FlowLinks | null): void {
  const { view, index, data, palette, height } = scene;
  const nodes = scene.emphasis?.nodes ?? null;
  // Slot = colour, plus BRANCH_COLORS for a bright link; without emphasis everything is bright.
  const paths = Array.from({ length: BRANCH_COLORS * 2 }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS * 2).fill(false);
  const { from, to } = commitsBetween(data, tFrom, tTo);
  const dense = to - from > DENSE;
  // Dense view: many links fall on the same pixel. Edges come sorted by their start, so
  // remembering the last pixel drawn per (from lane, to lane) is enough to skip the repeats.
  const lanes = index.maxLane + 1;
  const lastPixel = dense && lanes <= MAX_DEDUPE_LANES ? new Float64Array(lanes * lanes).fill(-Infinity) : null;
  const quantum = view.zx * 3600 < LOD_SQUARE ? 3 : 1;

  const segColor = new Int16Array(lanes).fill(-1);
  const segStart = new Float64Array(lanes);
  const segEnd = new Float64Array(lanes);
  const flushSegment = (lane: number) => {
    const slot = segColor[lane] ?? -1;
    if (slot < 0) return;
    const y = laneY(view, lane);
    paths[slot]?.moveTo(segStart[lane] ?? 0, y);
    paths[slot]?.lineTo(segEnd[lane] ?? 0, y);
    if (slot >= BRANCH_COLORS) links?.addStraight(segStart[lane] ?? 0, segEnd[lane] ?? 0, y, slot - BRANCH_COLORS);
    used[slot] = true;
    segColor[lane] = -1;
  };

  edgesBetween(data, tFrom, tTo, (e) => {
    const child = data.edgeChild[e] ?? 0;
    const parent = data.edgeParent[e] ?? 0;
    const childRow = index.rows[child];
    const parentRow = index.rows[parent];
    if (!childRow || !parentRow) return;
    const y1 = laneY(view, parentRow.lane);
    const y2 = laneY(view, childRow.lane);
    if ((y1 < AXIS_H - ROW_H && y2 < AXIS_H - ROW_H) || (y1 > height + ROW_H && y2 > height + ROW_H)) return;
    const x1 = screenX(view, data.times[parent] ?? 0);
    const x2 = screenX(view, data.times[child] ?? 0);
    if (dense && y1 === y2 && Math.abs(x2 - x1) < 2) return;
    if (lastPixel && y1 !== y2 && Math.abs(x2 - x1) < 3) {
      const key = parentRow.lane * lanes + childRow.lane;
      const px = Math.floor(x1 / quantum);
      if (lastPixel[key] === px) return;
      lastPixel[key] = px;
    }

    // A side branch's colour is the colour of its own commits: the child's for a first-parent
    // link, the parent's for the link a merge makes to the branch it takes in.
    const color = (data.edgeFirst[e] ? childRow.color : parentRow.color) % BRANCH_COLORS;
    const bright = !nodes || (nodes[child] === 1 && nodes[parent] === 1);
    const slot = bright ? color + BRANCH_COLORS : color;
    const path = paths[slot];
    if (!path) return;
    if (y1 === y2) {
      // Chains of links on one lane become one long line.
      const lane = childRow.lane;
      if (segColor[lane] === slot && x1 <= (segEnd[lane] ?? 0) + 1.5 && x2 >= (segStart[lane] ?? 0) - 1.5) {
        segStart[lane] = Math.min(segStart[lane] ?? x1, x1, x2);
        segEnd[lane] = Math.max(segEnd[lane] ?? x2, x1, x2);
      } else {
        flushSegment(lane);
        segColor[lane] = slot;
        segStart[lane] = Math.min(x1, x2);
        segEnd[lane] = Math.max(x1, x2);
      }
      return;
    }
    used[slot] = true;
    path.moveTo(x1, y1);
    if (Math.abs(x2 - x1) < 8) {
      path.lineTo(x2, y2);
    } else {
      const mid = (x1 + x2) / 2;
      path.bezierCurveTo(mid, y1, mid, y2, x2, y2);
      if (bright) links?.addCurve(x1, y1, x2, y2, color);
    }
  });

  for (let lane = 0; lane < lanes; lane++) flushSegment(lane);

  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (let slot = 0; slot < paths.length; slot++) {
    const path = paths[slot];
    if (!used[slot] || !path) continue;
    ctx.globalAlpha = slot < BRANCH_COLORS ? DIM_ALPHA : 1;
    ctx.strokeStyle = withAlpha(palette.branch[slot % BRANCH_COLORS] ?? palette.text3, 0.75);
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
}

function drawNodes(ctx: Ctx, scene: TimelineScene, tFrom: number, tTo: number): void {
  const { view, index, data, palette, width, height, selected, hovered } = scene;
  const { from, to } = commitsBetween(data, tFrom, tTo);
  const size = markerSize(view);
  const full = size === NODE;
  const colours = palette.branch;
  const nodes = scene.emphasis?.nodes ?? null;
  const dim = (column: number) => nodes !== null && !nodes[column];

  // Slot = colour, plus BRANCH_COLORS for a bright marker, so the faded ones go underneath.
  const paths = Array.from({ length: BRANCH_COLORS * 2 }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS * 2).fill(false);
  const visible: number[] = [];
  // Commits come in time order, so a marker that lands on the pixel of the previous one on its
  // lane (same colour) adds nothing: skipping it keeps far-out views cheap.
  const lastPixel = new Float64Array(index.maxLane + 1).fill(-Infinity);
  const lastColor = new Int16Array(index.maxLane + 1).fill(-1);

  for (let i = from; i < to; i++) {
    const column = data.order[i] ?? 0;
    const row = index.rows[column];
    if (!row) continue;
    const y = laneY(view, row.lane);
    if (y < AXIS_H - size || y > height + size) continue;
    const x = screenX(view, data.times[column] ?? 0);
    if (full) {
      visible.push(column);
      continue;
    }
    const slot = (row.color % BRANCH_COLORS) + (dim(column) ? 0 : BRANCH_COLORS);
    if (data.refMask[column]) visible.push(column);
    const px = Math.floor(x);
    if (lastPixel[row.lane] === px && lastColor[row.lane] === slot) continue;
    lastPixel[row.lane] = px;
    lastColor[row.lane] = slot;
    paths[slot]?.rect(x - size / 2, y - size / 2, size, size);
    used[slot] = true;
  }

  if (!full) {
    for (let slot = 0; slot < paths.length; slot++) {
      const path = paths[slot];
      if (!used[slot] || !path) continue;
      ctx.globalAlpha = slot < BRANCH_COLORS ? DIM_ALPHA : 1;
      ctx.fillStyle = colours[slot % BRANCH_COLORS] ?? palette.text3;
      ctx.fill(path);
    }
    ctx.globalAlpha = 1;
  }

  const badgeFree = new Float64Array(index.maxLane + 1).fill(-Infinity);
  const labelFree = new Float64Array(index.maxLane + 1).fill(-Infinity);
  ctx.textBaseline = "middle";

  for (const column of visible) {
    const row = index.rows[column];
    const commit = index.commits[column];
    if (!row || !commit) continue;
    const x = screenX(view, data.times[column] ?? 0);
    const y = laneY(view, row.lane);
    const color = colours[row.color % BRANCH_COLORS] ?? palette.text3;
    ctx.globalAlpha = dim(column) ? DIM_ALPHA : 1;

    if (full) {
      const merge = commit.parents.length > 1;
      ctx.beginPath();
      if (merge) ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      else ctx.roundRect(x - size / 2, y - size / 2, size, size, 4);
      ctx.fillStyle = merge ? color : palette.node;
      ctx.fill();
      ctx.lineWidth = column === hovered ? 2.6 : 1.8;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    if (column === selected) drawRing(ctx, palette, x, y, size);

    if (x < -40 || x > width + 40) continue;
    const labels = data.refMask[column] ? index.refs.get(commit.id) : undefined;
    if (labels) drawBadges(ctx, palette, labels, color, x, y - size / 2 - 6, row.lane, badgeFree, full);
    if (full) drawCaption(ctx, palette, commit.summary, commit.parents.length, column === selected, x, y + size / 2 + 9, row.lane, labelFree);
  }
  ctx.globalAlpha = 1;

  // The selected commit stays marked even when it is not drawn as a full node.
  if (selected !== null && !full && !data.refMask[selected]) {
    const row = index.rows[selected];
    if (row) drawRing(ctx, palette, screenX(view, data.times[selected] ?? 0), laneY(view, row.lane), size);
  }
}

function drawRing(ctx: Ctx, palette: Palette, x: number, y: number, size: number): void {
  const r = Math.max(size, 8) / 2 + 4;
  ctx.beginPath();
  ctx.roundRect(x - r, y - r, r * 2, r * 2, r);
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();
}

function drawCaption(
  ctx: Ctx,
  palette: Palette,
  summary: string,
  parentCount: number,
  selected: boolean,
  x: number,
  y: number,
  lane: number,
  free: Float64Array,
): void {
  if (x - (free[lane] ?? -Infinity) < 24) return;
  ctx.font = `500 11px ${palette.fontUi}`;
  const described = describeCommit(summary, parentCount);
  // The marker is too small for the emoji, so it leads the caption instead.
  const text = fitText(ctx, described.emoji ? `${described.emoji} ${described.label}` : described.label, CAPTION_MAX);
  const width = ctx.measureText(text).width;
  const left = x - width / 2;
  if (left < (free[lane] ?? -Infinity) + 6) return;
  free[lane] = left + width;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.canvas;
  ctx.fillStyle = selected ? palette.accentText : palette.text2;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

const CAPTION_MAX = 150;
/** Longest badge, in pixels. */
const BADGE_MAX = 220;

function drawBadges(
  ctx: Ctx,
  palette: Palette,
  labels: RefLabel[],
  color: string,
  x: number,
  bottom: number,
  lane: number,
  free: Float64Array,
  withTags: boolean,
): void {
  const shown = labels.filter((l) => withTags || l.kind !== "Tag").sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const first = shown[0];
  if (!first) return;
  const extra = shown.length - 1;
  ctx.font = `500 11px ${palette.fontUi}`;
  const isHead = first.kind === "Head";
  const chip = isHead ? 34 : 0;
  // Only the name is cut; the "◆" and the "+n" stay.
  const prefix = first.kind === "Tag" ? "◆ " : "";
  const suffix = extra > 0 ? ` +${extra}` : "";
  const room = BADGE_MAX - 14 - chip - ctx.measureText(prefix + suffix).width;
  const text = prefix + fitText(ctx, first.name, room) + suffix;
  const width = ctx.measureText(text).width + 14 + chip;
  const left = x - width / 2;
  if (left < (free[lane] ?? -Infinity) + 4) return;
  free[lane] = left + width;

  const height = 18;
  const top = bottom - height;
  ctx.beginPath();
  ctx.roundRect(left, top, width, height, 5);
  ctx.fillStyle = palette.canvas;
  ctx.fill();
  ctx.fillStyle = withAlpha(color, first.kind === "Remote" ? 0 : 0.16);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(color, 0.45);
  ctx.stroke();

  ctx.textAlign = "left";
  let textX = left + 7;
  if (isHead) {
    ctx.beginPath();
    ctx.roundRect(left + 3, top + 3, 28, height - 6, 3);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = palette.canvas;
    ctx.font = `700 8.5px ${palette.fontMono}`;
    ctx.fillText("HEAD", left + 6, top + height / 2 + 0.5);
    ctx.font = `500 11px ${palette.fontUi}`;
    textX = left + 35;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, textX, top + height / 2 + 0.5);
}

function drawAxis(ctx: Ctx, scene: TimelineScene, ticks: ReturnType<typeof timeTicks>): void {
  const { width, view, palette } = scene;
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, AXIS_H);
  ctx.fillStyle = palette.dot;
  ctx.fillRect(0, AXIS_H - 1, width, 1);

  ctx.font = `500 11px ${palette.fontMono}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  ctx.strokeStyle = palette.text3;
  for (const tick of ticks) {
    const x = Math.round(screenX(view, tick.time)) + 0.5;
    if (x < -80 || x > width) continue;
    ctx.beginPath();
    ctx.moveTo(x, tick.major ? 4 : 14);
    ctx.lineTo(x, AXIS_H - 1);
    ctx.stroke();
    ctx.fillStyle = tick.major ? palette.text : palette.text3;
    ctx.fillText(tick.label, x + 5, AXIS_H / 2 + (tick.major ? 0 : 2));
  }
}

/** Column of the commit under a screen point, or null. */
export function hitTestTimeline(
  data: TimelineData,
  index: GraphIndex,
  view: TimelineView,
  px: number,
  py: number,
): number | null {
  if (data.count === 0 || py < AXIS_H) return null;
  const reach = Math.max(markerSize(view) / 2 + 4, 7);
  const t = view.t0 + px / view.zx;
  const span = reach / view.zx;
  const { from, to } = commitsBetween(data, t - span, t + span);
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = from; i < to; i++) {
    const column = data.order[i] ?? 0;
    const row = index.rows[column];
    if (!row) continue;
    const dx = screenX(view, data.times[column] ?? 0) - px;
    const dy = laneY(view, row.lane) - py;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = column;
    }
  }
  return best;
}
