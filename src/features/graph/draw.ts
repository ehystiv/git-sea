import type { PullBadge } from "../pulls/pulls";
import type { RefLabel } from "../../lib/bindings";
import { bob, ripples } from "./bob";
import { shortHash } from "../../lib/format";
import {
  BRANCH_COLORS,
  COLUMN_W,
  HALF,
  LANE_H,
  LOD_CARD,
  LOD_TILE,
  MIN_COLUMN_PX,
  NODE,
} from "./constants";
import { drawCi, type CiScene } from "./ciDraw";
import { describeCommit, type CommitKind, type Described } from "./describe";
import { DIM_ALPHA, emphasisFits, type Emphasis } from "./emphasis";
import type { CommitGroup, GraphIndex } from "./GraphIndex";
import { iconPath } from "./icons";
import { FlowLinks, type FlowFrame } from "./flow";
import { ARRIVAL, arrivalProgress, firstAtLeast } from "./morph";
import type { Palette } from "./palette";

export interface View {
  /** Screen position of world origin, in CSS pixels. */
  tx: number;
  ty: number;
  z: number;
}

/** Text measurements and commit descriptions are worth keeping between frames. */
export class RenderCache {
  described = new Map<number, Described>();
  wrapped = new Map<string, string[]>();

  trim(): void {
    if (this.described.size > 4000) this.described.clear();
    if (this.wrapped.size > 4000) this.wrapped.clear();
  }
}

/** Pixels per second the dots travel at zoom 1, and the distance between them. */
const FLOW_SPEED = 64;
const FLOW_SPACING = 96;

export interface Scene {
  width: number;
  height: number;
  dpr: number;
  view: View;
  index: GraphIndex;
  palette: Palette;
  cache: RenderCache;
  selected: number | null;
  hovered: number | null;
  /** Whether to collect the links for the dots moving along them (drawn by the caller). */
  flow: boolean;
  /** Commits and links to keep bright while the rest fades (search, ancestors); null for none. */
  emphasis: Emphasis | null;
  /**
   * A run opening or closing, or new commits arriving: where each column of `index` is right now
   * (in columns, sorted) and which commits fade in (1) or out (-1), at progress `t`. Null when
   * nothing moves.
   */
  morph: { positions: Float64Array; fade: Int8Array; t: number; arrival: Arrival | null } | null;
  /** Local changes on top of a commit (HEAD's), shown as a badge on its node; null for none. */
  worktree: WorktreeMarker | null;
  /** CI runs and the places a workflow would start; null for none. */
  ci: CiScene | null;
  /** Ids of the bookmarked commits, marked with a ribbon on their node. */
  bookmarks: ReadonlySet<string>;
  /** Pull or merge requests drawn above the refs of their commit, by commit id. */
  pulls: ReadonlyMap<string, readonly PullBadge[]>;
  /** A clicked node bobbing like a float (column, milliseconds since the click); null for none. */
  bob: { column: number; ms: number } | null;
}

/** How many files have local changes, and the commit they sit on. */
export interface WorktreeMarker {
  id: string;
  files: number;
}

/** New commits entering: their order (see `Morph.order`) and the milliseconds since it started. */
export interface Arrival {
  order: Int16Array;
  elapsed: number;
  /** Reduced motion: the new commits only fade in, nothing grows, traces or rings. */
  gentle: boolean;
  /**
   * Longest piece of a link that is traced, in columns, ending at the new node; the rest is drawn
   * from the start. Unset: the whole link from the parent (the replay keeps it short, since there
   * a parent can be far away and hiding the whole link would cut every line crossing it).
   */
  maxTrace?: number;
}

/** Screen x of the centre of column `r`, following a running morph. */
function columnX(scene: Scene, r: number): number {
  const column = scene.morph ? (scene.morph.positions[r] ?? r) : r;
  return -column * COLUMN_W * scene.view.z + scene.view.tx;
}

/** Opacity of column `r` while a morph fades it in or out. */
function morphAlpha(scene: Scene, r: number): number {
  const morph = scene.morph;
  const fade = morph?.fade[r] ?? 0;
  if (!morph || fade === 0) return 1;
  const pop = arrivalStage(scene, ARRIVAL.pop, r);
  if (pop !== null) return morph.arrival?.gentle ? pop : Math.min(1, pop * 2);
  return fade > 0 ? morph.t : 1 - morph.t;
}

/** Progress of a stage for a new commit, or null when column `r` is not arriving. */
function arrivalStage(scene: Scene, stage: { at: number; ms: number }, r: number): number | null {
  const arrival = scene.morph?.arrival;
  const order = arrival?.order[r] ?? -1;
  return arrival && order >= 0 ? arrivalProgress(stage, arrival.elapsed, order) : null;
}

/** Size of a new commit's node as it pops in, overshooting a little before it settles. */
function arrivalScale(scene: Scene, r: number): number {
  const pop = arrivalStage(scene, ARRIVAL.pop, r);
  if (pop === null || scene.morph?.arrival?.gentle) return 1;
  const back = 1.70158;
  return 1 + (back + 1) * (pop - 1) ** 3 + back * (pop - 1) ** 2;
}

type Ctx = CanvasRenderingContext2D;

/**
 * Draws a frame. Returns the links the dots move along, for the caller to animate them without
 * redrawing the frame; null when the dots are off or there are no links to move on.
 */
export function draw(ctx: Ctx, input: Scene): FlowFrame | null {
  // A mask built for an older load would light the wrong commits; better none until it catches up.
  const scene = emphasisFits(input.emphasis, input.index) ? input : { ...input, emphasis: null };
  const { width, height, view, index, palette } = scene;
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  // Transparent: the background colour, and the sea, are under this canvas.
  ctx.clearRect(0, 0, width, height);
  drawDots(ctx, scene);

  const count = index.length;
  if (count === 0) return null;

  const z = view.z;
  const xMin = -view.tx / z;
  const xMax = (width - view.tx) / z;
  const positions = scene.morph?.positions;
  // Columns move during a morph, but stay in order, so the visible ones can still be searched.
  const first = positions ? Math.max(0, firstAtLeast(positions, -xMax / COLUMN_W - 1) - 1) : Math.max(0, Math.floor(-xMax / COLUMN_W) - 1);
  const last = positions ? Math.min(count - 1, firstAtLeast(positions, -xMin / COLUMN_W + 1)) : Math.min(count - 1, Math.ceil(-xMin / COLUMN_W) + 1);
  if (first > last) return null;

  const columnPx = COLUMN_W * z;
  const stride = columnPx >= MIN_COLUMN_PX || scene.morph ? 1 : Math.ceil(MIN_COLUMN_PX / columnPx);

  // Dots travel along the links only where the links are drawn one by one.
  const links = scene.flow && stride === 1 && z >= LOD_TILE ? new FlowLinks() : null;
  const clipped = clipUntraced(ctx, scene, last);
  drawEdges(ctx, scene, first, last, stride, links);
  if (clipped) ctx.restore();
  const flow: FlowFrame | null =
    links && !links.isEmpty
      ? {
          links,
          style: {
            anchor: view.tx,
            spacing: FLOW_SPACING * z,
            speed: FLOW_SPEED * z,
            radius: Math.max(2, Math.min(4, 3.4 * z)),
            width,
            height,
            palette,
          },
          top: 0,
        }
      : null;
  if (z < LOD_TILE) drawDots2(ctx, scene, first, last, stride);
  else {
    // On the water, under the node floating on it.
    drawRipples(ctx, scene);
    drawNodes(ctx, scene, first, last);
  }
  // Markers would lag behind columns that move.
  if (!scene.morph) drawCi(ctx, scene, first, last);
  drawWorktree(ctx, scene);
  scene.cache.trim();
  return flow;
}

/**
 * Hides the part of each new commit's link that is not traced yet: the line grows from the parent
 * towards the new node. Returns true when a clip was set (and must be restored).
 */
function clipUntraced(ctx: Ctx, scene: Scene, last: number): boolean {
  const arrival = scene.morph?.arrival;
  if (!arrival || arrival.gentle) return false;
  const { index, view, width, height } = scene;
  const pad = Math.max(4, 4 * view.z);
  const hidden = new Path2D();
  hidden.rect(0, 0, width, height);
  let any = false;
  // New commits sit near the tip, but their links reach left, so start from the first column.
  for (let r = 0; r <= last; r++) {
    const trace = arrivalStage(scene, ARRIVAL.trace, r);
    if (trace === null || trace >= 1) continue;
    const parent = index.parentIndex(r) ?? (r + 1 < index.length ? r + 1 : null);
    const nodeX = columnX(scene, r);
    const parentX = parent === null ? nodeX - COLUMN_W * view.z : columnX(scene, parent);
    const from = arrival.maxTrace === undefined ? parentX : Math.max(parentX, nodeX - arrival.maxTrace * COLUMN_W * view.z);
    const reached = from + (nodeX - from) * (1 - (1 - trace) ** 3);
    const y = (index.rows[r]?.lane ?? 0) * LANE_H * view.z + view.ty;
    if (nodeX <= reached) continue;
    hidden.rect(reached, y - pad, nodeX - reached, pad * 2);
    any = true;
  }
  if (!any) return false;
  ctx.save();
  ctx.clip(hidden, "evenodd");
  return true;
}

/**
 * Where the badge of local changes sits: a circle on the top right corner of the node of the
 * commit they are on. `x` gives a column's screen x. Null when there is nothing to show.
 */
function worktreeBadge(
  index: GraphIndex,
  view: View,
  marker: WorktreeMarker | null,
  x: (column: number) => number,
): { x: number; y: number; radius: number } | null {
  if (!marker || marker.files <= 0) return null;
  const column = index.indexOf(marker.id);
  const row = column === null ? undefined : index.rows[column];
  if (column === null || !row) return null;
  const z = view.z;
  // Far out the node is a small square (see drawDots2); the badge keeps a readable size.
  const size = z >= LOD_TILE ? NODE * z : Math.max(2, Math.min(9, NODE * z * 1.2));
  return { x: x(column) + size / 2, y: row.lane * LANE_H * z + view.ty - size / 2, radius: Math.max(8, 11 * z) };
}

/** Whether a point (CSS pixels) is on the badge of local changes. */
export function hitWorktree(index: GraphIndex, view: View, marker: WorktreeMarker | null, px: number, py: number): boolean {
  const badge = worktreeBadge(index, view, marker, (r) => -r * COLUMN_W * view.z + view.tx);
  return badge !== null && Math.hypot(px - badge.x, py - badge.y) <= badge.radius + 3;
}

function drawWorktree(ctx: Ctx, scene: Scene): void {
  const { palette, worktree } = scene;
  const badge = worktreeBadge(scene.index, scene.view, worktree, (r) => columnX(scene, r));
  if (!badge || !worktree) return;
  const { x, y, radius } = badge;
  const text = worktree.files > 99 ? "99+" : String(worktree.files);
  ctx.font = `600 ${radius * 1.05}px ${palette.fontUi}`;
  // Wider counts stretch the circle into a pill rather than shrink the text.
  const half = Math.max(0, ctx.measureText(text).width / 2 + radius * 0.45 - radius);
  ctx.beginPath();
  ctx.roundRect(x - radius - half, y - radius, (radius + half) * 2, radius * 2, radius);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, radius * 0.18);
  ctx.strokeStyle = palette.canvas;
  ctx.stroke();
  ctx.fillStyle = palette.accentContrast;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + radius * 0.05);
}

/** A ring spreading out of a new commit's node once it has popped in, then fading. */
function drawPing(ctx: Ctx, scene: Scene, r: number, cx: number, cy: number, color: string, leftRound: boolean): void {
  if (scene.morph?.arrival?.gentle) return;
  const ping = arrivalStage(scene, ARRIVAL.ping, r);
  if (ping === null || ping <= 0 || ping >= 1) return;
  const z = scene.view.z;
  const size = NODE * z;
  const radius = 12 * z;
  const gap = (4 + 22 * (1 - (1 - ping) ** 3)) * z;
  const leftRadius = leftRound ? size / 2 : radius;
  ctx.beginPath();
  ctx.roundRect(cx - size / 2 - gap, cy - size / 2 - gap, size + gap * 2, size + gap * 2, [
    leftRadius + gap,
    radius + gap,
    radius + gap,
    leftRadius + gap,
  ]);
  ctx.globalAlpha = 0.55 * (1 - ping);
  ctx.lineWidth = Math.max(1, 2 * z);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDots(ctx: Ctx, { width, height, view, palette }: Scene): void {
  let spacing = 22 * view.z;
  while (spacing < 12) spacing *= 2;
  const startX = ((view.tx % spacing) + spacing) % spacing;
  const startY = ((view.ty % spacing) + spacing) % spacing;
  ctx.fillStyle = palette.dot;
  ctx.beginPath();
  for (let x = startX; x < width; x += spacing) {
    for (let y = startY; y < height; y += spacing) ctx.rect(x - 0.6, y - 0.6, 1.2, 1.2);
  }
  ctx.fill();
}

function drawEdges(ctx: Ctx, scene: Scene, first: number, last: number, stride: number, flowLinks: FlowLinks | null): void {
  const { view, index, palette, height } = scene;
  const { ty, z } = view;
  const columnPx = COLUMN_W * z;
  const halfColumn = (COLUMN_W / 2) * z;
  const halfNode = HALF * z;
  const rows = index.rows;
  const paths = Array.from({ length: BRANCH_COLORS }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS).fill(false);
  const emphasis = scene.emphasis;
  const dimPaths = Array.from({ length: emphasis ? BRANCH_COLORS : 0 }, () => new Path2D());
  const dimUsed = new Array<boolean>(BRANCH_COLORS).fill(false);
  const sy = (lane: number) => lane * LANE_H * z + ty;
  const margin = 24;

  const curve = (path: Path2D, x1: number, y1: number, x2: number, y2: number) => {
    path.moveTo(x1, y1);
    if (columnPx < 6) {
      path.lineTo(x2, y2);
    } else {
      const mid = (x1 + x2) / 2;
      path.bezierCurveTo(mid, y1, mid, y2, x2, y2);
    }
  };

  for (let r = first - (first % stride); r <= last; r += stride) {
    const row = rows[r];
    if (!row) continue;
    const centerX = columnX(scene, r);
    // During a morph the columns are unevenly spaced: each one reaches halfway to its neighbours,
    // so the lines stay continuous.
    const right = scene.morph && r > 0 ? (centerX + columnX(scene, r - 1)) / 2 : centerX + halfColumn;
    const left = scene.morph && r < rows.length - 1 ? (centerX + columnX(scene, r + 1)) / 2 : centerX - halfColumn;
    const sampledLeft = left - (stride - 1) * columnPx;
    const nodeY = sy(row.lane);
    const hasIn = stride > 1 && row.edges.some((e) => e.kind === "In");
    // A morph can squeeze thousands of columns onto one point; their straight pieces have no length.
    const flat = scene.morph !== null && right - left < 0.5;

    const edgeBase = emphasis?.edgeStart?.[r] ?? 0;
    for (let k = 0; k < row.edges.length; k++) {
      const edge = row.edges[k];
      if (!edge || (flat && edge.kind !== "MergeIn" && edge.kind !== "ForkOut")) continue;
      const color = edge.color % BRANCH_COLORS;
      const bright = !emphasis || emphasis.edges?.[edgeBase + k] === 1;
      const path = bright ? paths[color] : dimPaths[color];
      if (!path) continue;
      const fromY = sy(edge.fromLane);
      const toY = sy(edge.toLane);
      if (Math.max(fromY, toY) < -margin || Math.min(fromY, toY) > height + margin) continue;
      if (bright) used[color] = true;
      else dimUsed[color] = true;
      // Faded links carry no dots.
      const links = bright ? flowLinks : null;

      switch (edge.kind) {
        case "Through":
          path.moveTo(right, fromY);
          path.lineTo(sampledLeft, fromY);
          links?.addStraight(sampledLeft, right, fromY, color);
          break;
        case "In":
          path.moveTo(right, nodeY);
          path.lineTo(stride > 1 ? sampledLeft : centerX + halfNode, nodeY);
          links?.addStraight(centerX + halfNode, right, nodeY, color);
          break;
        case "Out":
          if (stride === 1 || !hasIn) {
            path.moveTo(centerX - halfNode, nodeY);
            path.lineTo(sampledLeft, nodeY);
            links?.addStraight(sampledLeft, centerX - halfNode, nodeY, color);
          }
          break;
        case "MergeIn":
          curve(path, right, fromY, centerX + halfNode, nodeY);
          links?.addCurve(right, fromY, centerX + halfNode, nodeY, color);
          break;
        case "ForkOut":
          curve(path, centerX - halfNode, nodeY, left, toY);
          links?.addCurve(centerX - halfNode, nodeY, left, toY, color);
          break;
      }
    }
  }

  ctx.lineWidth = Math.max(1, Math.min(2.5, 2 * z));
  ctx.lineCap = "round";
  ctx.globalAlpha = DIM_ALPHA;
  for (let c = 0; c < dimPaths.length; c++) {
    const path = dimPaths[c];
    if (!dimUsed[c] || !path) continue;
    ctx.strokeStyle = palette.branch[c] ?? palette.text3;
    ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  for (let c = 0; c < BRANCH_COLORS; c++) {
    const path = paths[c];
    if (!used[c] || !path) continue;
    ctx.strokeStyle = palette.branch[c] ?? palette.text3;
    ctx.stroke(path);
  }
}

/** Zoomed far out: nodes are small coloured squares, one per sampled column. */
function drawDots2(ctx: Ctx, scene: Scene, first: number, last: number, stride: number): void {
  const { view, index, palette, height } = scene;
  const { ty, z } = view;
  const size = Math.max(2, Math.min(9, NODE * z * 1.2));
  const nodes = scene.emphasis?.nodes ?? null;
  // Bright squares are drawn after the faded ones, so a sampled column never hides a match.
  const paths = Array.from({ length: BRANCH_COLORS * 2 }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS * 2).fill(false);

  for (let r = first - (first % stride); r <= last; r += stride) {
    const row = index.rows[r];
    if (!row) continue;
    const x = columnX(scene, r);
    const y = row.lane * LANE_H * z + ty;
    if (y < -size || y > height + size) continue;
    const slot = (row.color % BRANCH_COLORS) + (nodes && !hasBright(nodes, r, stride) ? 0 : BRANCH_COLORS);
    paths[slot]?.rect(x - size / 2, y - size / 2, size, size);
    used[slot] = true;
  }
  for (let slot = 0; slot < paths.length; slot++) {
    const path = paths[slot];
    if (!used[slot] || !path) continue;
    ctx.globalAlpha = nodes && slot < BRANCH_COLORS ? DIM_ALPHA : 1;
    ctx.fillStyle = palette.branch[slot % BRANCH_COLORS] ?? palette.text3;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
}

/** A sampled column stands for `stride` columns; it is bright when any of them is. */
function hasBright(nodes: Uint8Array, r: number, stride: number): boolean {
  for (let i = r; i < r + stride && i < nodes.length; i++) if (nodes[i]) return true;
  return false;
}

function drawNodes(ctx: Ctx, scene: Scene, first: number, last: number): void {
  const { view, index, palette, width, height, selected } = scene;
  const { ty, z } = view;
  const size = NODE * z;
  // During a morph, nodes still stacked on the one drawn before them on their lane are skipped:
  // a run of thousands of commits would otherwise be drawn thousands of times on one spot. New
  // commits arriving start on top of the commit they push aside, and both must show.
  const lastX = scene.morph && !scene.morph.arrival ? new Float64Array(index.maxLane + 1).fill(Infinity) : null;

  for (let r = first; r <= last; r++) {
    const row = index.rows[r];
    if (!row || !index.commits[r]) continue;
    const cx = columnX(scene, r);
    const cy = row.lane * LANE_H * z + ty;
    if (cx < -COLUMN_W * z || cx > width + COLUMN_W * z || cy < -size * 2 || cy > height + size * 2) {
      continue;
    }
    if (lastX) {
      if (Math.abs((lastX[row.lane] ?? Infinity) - cx) < size / 2 && r !== selected) continue;
      lastX[row.lane] = cx;
    }

    const arrival = arrivalScale(scene, r);
    if (arrival <= 0) continue;
    // The node, its label and badges move together; the links stay where they are.
    const floating = scene.bob?.column === r ? bob(scene.bob.ms) : null;
    const scale = arrival * (floating?.scale ?? 1);
    const dy = (floating?.dy ?? 0) * z;
    const moved = scale !== 1 || dy !== 0;
    if (moved) {
      ctx.save();
      ctx.translate(cx, cy + dy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }
    drawNode(ctx, scene, r, cx, cy);
    if (moved) ctx.restore();
    const color = palette.branch[row.color % BRANCH_COLORS] ?? palette.text3;
    drawPing(ctx, scene, r, cx, cy, color, !row.edges.some((e) => e.kind === "In" || e.kind === "MergeIn"));
  }
  ctx.globalAlpha = 1;
}

function drawNode(ctx: Ctx, scene: Scene, r: number, cx: number, cy: number): void {
  const { view, index, palette, selected, hovered } = scene;
  const row = index.rows[r];
  const commit = index.commits[r];
  if (!row || !commit) return;
  const nodes = scene.emphasis?.nodes ?? null;
  const { z } = view;
  const size = NODE * z;
  const card = z >= LOD_CARD;
  const radius = 12 * z;

  const color = palette.branch[row.color % BRANCH_COLORS] ?? palette.text3;
  const hasChildren = row.edges.some((e) => e.kind === "In" || e.kind === "MergeIn");
  const left = cx - size / 2;
  const top = cy - size / 2;

  ctx.globalAlpha = (nodes && !nodes[r] ? DIM_ALPHA : 1) * morphAlpha(scene, r);
  const group = index.groups.get(r);
  const leftRadius = hasChildren ? radius : size / 2;
  if (group && z >= LOD_TILE) drawStack(ctx, palette, color, left, top, size, z, radius);
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, [leftRadius, radius, radius, leftRadius]);
  ctx.fillStyle = palette.node;
  ctx.fill();
  ctx.lineWidth = Math.max(1, (r === hovered ? 2.4 : 1.5) * z);
  ctx.strokeStyle = color;
  ctx.stroke();

  if (r === selected) {
    ctx.beginPath();
    const gap = 4 * z;
    ctx.roundRect(left - gap, top - gap, size + gap * 2, size + gap * 2, [
      leftRadius + gap,
      radius + gap,
      radius + gap,
      leftRadius + gap,
    ]);
    ctx.lineWidth = Math.max(1.5, 2 * z);
    ctx.strokeStyle = palette.accent;
    ctx.stroke();
  }

  if (z >= LOD_TILE && scene.bookmarks.has(commit.id)) drawRibbon(ctx, palette.accent, left + size - 16 * z, top, z);

  if (!card) return;

  drawPorts(ctx, palette, cx, cy, size, z, commit.parents.length > 0, hasChildren);
  if (group) {
    drawGroup(ctx, palette, group, r === selected, color, cx, cy, size, z, commit.id);
    return;
  }
  const described = describe(scene, r);
  if (described.emoji) drawEmoji(ctx, described.emoji, cx, cy, z);
  else drawIcon(ctx, palette, described.kind, row.color, cx, cy, z);
  drawLabel(ctx, scene, r, described, cx, cy + size / 2 + 8 * z);
  drawBadges(ctx, scene, index.refs.get(commit.id), scene.pulls.get(commit.id), row.color, cx, top - 8 * z);
}

/** Rings spreading on the water from the node that was just clicked, in its branch's colour. */
function drawRipples(ctx: Ctx, scene: Scene): void {
  const poke = scene.bob;
  const row = poke ? scene.index.rows[poke.column] : undefined;
  if (!poke || !row) return;
  const rings = ripples(poke.ms);
  if (rings.length === 0) return;
  const z = scene.view.z;
  const cx = columnX(scene, poke.column);
  const cy = row.lane * LANE_H * z + scene.view.ty;
  const size = NODE * z;
  const color = scene.palette.branch[row.color % BRANCH_COLORS] ?? scene.palette.text3;
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(cx, cy, ring.radius * size, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(color, ring.alpha);
    ctx.lineWidth = Math.max(0.75, ring.width * z);
    ctx.stroke();
  }
}

/** A bookmark ribbon hanging from the top edge of a node, near its right corner. */
function drawRibbon(ctx: Ctx, color: string, x: number, top: number, z: number): void {
  const w = 9 * z;
  const h = 13 * z;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x + w, top);
  ctx.lineTo(x + w, top + h);
  ctx.lineTo(x + w / 2, top + h - 3.5 * z);
  ctx.lineTo(x, top + h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Two outlines peeking out behind a node that stands for several commits. */
function drawStack(
  ctx: Ctx,
  palette: Palette,
  color: string,
  left: number,
  top: number,
  size: number,
  z: number,
  radius: number,
): void {
  ctx.lineWidth = Math.max(1, 1.5 * z);
  ctx.strokeStyle = withAlpha(color, 0.55);
  ctx.fillStyle = palette.node;
  for (const step of [2, 1]) {
    ctx.beginPath();
    ctx.roundRect(left - step * 6 * z, top - step * 6 * z, size, size, radius);
    ctx.fill();
    ctx.stroke();
  }
}

/** "1,2k"-style count that fits inside a node. */
function compactCount(count: number): string {
  return count < 1000 ? String(count) : `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
}

/** Content of a node that stands for a run of commits: the count inside, the range below. */
function drawGroup(
  ctx: Ctx,
  palette: Palette,
  group: CommitGroup,
  selected: boolean,
  color: string,
  cx: number,
  cy: number,
  size: number,
  z: number,
  newestId: string,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${20 * z}px ${palette.fontMono}`;
  ctx.fillStyle = color;
  ctx.fillText(compactCount(group.count), cx, cy);

  const top = cy + size / 2 + 8 * z;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4 * z;
  ctx.strokeStyle = palette.canvas;
  ctx.font = `600 ${12 * z}px ${palette.fontUi}`;
  ctx.fillStyle = selected ? palette.accentText : palette.text;
  const label = `${group.count} commit`;
  ctx.strokeText(label, cx, top);
  ctx.fillText(label, cx, top);
  ctx.font = `${10.5 * z}px ${palette.fontMono}`;
  ctx.fillStyle = palette.text3;
  const range = `${shortHash(newestId)} … ${shortHash(group.oldestId)}`;
  ctx.strokeText(range, cx, top + 16 * z);
  ctx.fillText(range, cx, top + 16 * z);
}

function describe(scene: Scene, r: number): Described {
  let described = scene.cache.described.get(r);
  if (!described) {
    const commit = scene.index.commits[r];
    described = describeCommit(commit?.summary ?? "", commit?.parents.length ?? 0);
    scene.cache.described.set(r, described);
  }
  return described;
}

function drawPorts(
  ctx: Ctx,
  palette: Palette,
  cx: number,
  cy: number,
  size: number,
  z: number,
  hasParents: boolean,
  hasChildren: boolean,
): void {
  ctx.fillStyle = palette.text3;
  if (hasParents) {
    ctx.beginPath();
    ctx.roundRect(cx - size / 2 - 9 * z, cy - 7 * z, 6 * z, 14 * z, [2 * z, 0, 0, 2 * z]);
    ctx.fill();
  }
  if (hasChildren) {
    ctx.beginPath();
    ctx.arc(cx + size / 2 + z, cy, 6 * z, 0, Math.PI * 2);
    ctx.fill();
  }
}

function kindColor(palette: Palette, kind: CommitKind): string {
  const branch = (i: number) => palette.branch[i] ?? palette.text2;
  switch (kind) {
    case "merge":
      return branch(0);
    case "feat":
      return branch(1);
    case "fix":
    case "perf":
      return branch(2);
    case "refactor":
      return branch(4);
    case "docs":
      return branch(7);
    case "init":
      return branch(5);
    case "chore":
    case "commit":
      return palette.text2;
  }
}

/** System colour-emoji fonts; the UI fonts have no emoji glyphs. */
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** The commit's own emoji (gitmoji style), in place of the kind icon. */
function drawEmoji(ctx: Ctx, emoji: string, cx: number, cy: number, z: number): void {
  ctx.font = `${26 * z}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Emoji glyphs sit a little high on the middle baseline.
  ctx.fillText(emoji, cx, cy + 1.5 * z);
}

function drawIcon(
  ctx: Ctx,
  palette: Palette,
  kind: CommitKind,
  _laneColor: number,
  cx: number,
  cy: number,
  z: number,
): void {
  const k = (28 / 24) * z;
  ctx.save();
  ctx.translate(cx - 12 * k, cy - 12 * k);
  ctx.scale(k, k);
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = kindColor(palette, kind);
  ctx.stroke(iconPath(kind));
  ctx.restore();
}

function drawLabel(
  ctx: Ctx,
  scene: Scene,
  r: number,
  described: Described,
  cx: number,
  top: number,
): void {
  const { palette, view, index } = scene;
  const z = view.z;
  const maxWidth = (COLUMN_W - 20) * z;
  const lineHeight = 15 * z;

  ctx.font = `600 ${12 * z}px ${palette.fontUi}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const key = `${r}:${Math.round(z * 50)}`;
  let lines = scene.cache.wrapped.get(key);
  if (!lines) {
    lines = wrap(ctx, described.label, maxWidth);
    scene.cache.wrapped.set(key, lines);
  }
  // A halo in the canvas colour keeps text readable where edges run behind it.
  ctx.lineJoin = "round";
  ctx.lineWidth = 4 * z;
  ctx.strokeStyle = palette.canvas;
  ctx.fillStyle = r === scene.selected ? palette.accentText : palette.text;
  lines.forEach((line, i) => {
    ctx.strokeText(line, cx, top + i * lineHeight, maxWidth);
    ctx.fillText(line, cx, top + i * lineHeight, maxWidth);
  });

  const commit = index.commits[r];
  if (!commit) return;
  ctx.font = `${10.5 * z}px ${palette.fontMono}`;
  const sub = `${described.kind} · ${shortHash(commit.id)}`;
  const subY = top + lines.length * lineHeight + 1 * z;
  ctx.fillStyle = palette.text3;
  ctx.strokeText(sub, cx, subY);
  ctx.fillText(sub, cx, subY);
}

/** Greedy word wrap into at most two lines; the second one is ellipsised when too long. */
function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const words = text.split(" ");
  let first = "";
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = first ? `${first} ${words[i]}` : (words[i] ?? "");
    if (ctx.measureText(candidate).width > maxWidth && first) break;
    first = candidate;
  }
  let second = words.slice(i).join(" ");
  if (!second) return [truncate(ctx, first, maxWidth)];
  if (ctx.measureText(second).width > maxWidth) second = truncate(ctx, second, maxWidth);
  return [truncate(ctx, first, maxWidth), second];
}

function truncate(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end)}…`;
}

const KIND_ORDER: Record<RefLabel["kind"], number> = { Head: 0, Branch: 1, Remote: 2, Tag: 3 };
const MAX_BADGES = 3;

function drawBadges(
  ctx: Ctx,
  scene: Scene,
  labels: RefLabel[] | undefined,
  pulls: readonly PullBadge[] | undefined,
  laneColor: number,
  cx: number,
  bottom: number,
): void {
  if ((!labels || labels.length === 0) && (!pulls || pulls.length === 0)) return;
  labels ??= [];
  const { palette, view } = scene;
  const z = view.z;
  const color = palette.branch[laneColor % BRANCH_COLORS] ?? palette.accent;
  const sorted = [...labels].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  const shown = sorted.slice(0, MAX_BADGES);
  const hidden = sorted.length - shown.length;
  const height = 18 * z;
  const gap = 4 * z;

  ctx.font = `500 ${11 * z}px ${palette.fontUi}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const texts = shown.map((l) => (l.kind === "Tag" ? `◆ ${l.name}` : l.name));
  if (hidden > 0) texts.push(`+${hidden}`);

  let y = bottom - height;
  for (let i = 0; i < texts.length; i++) {
    const label = shown[i];
    const isHead = label?.kind === "Head";
    const chip = isHead ? 34 * z : 0;
    const text = fitText(ctx, texts[i] ?? "", COLUMN_W * z * 1.3 - 14 * z - chip);
    const width = ctx.measureText(text).width + 14 * z + chip;
    const x = cx - width / 2;

    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 5 * z);
    ctx.fillStyle = withAlpha(color, label?.kind === "Remote" ? 0 : 0.16);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.stroke();

    let textX = x + 7 * z;
    if (isHead) {
      ctx.beginPath();
      ctx.roundRect(x + 3 * z, y + 3 * z, 28 * z, height - 6 * z, 3 * z);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = palette.canvas;
      ctx.font = `700 ${8.5 * z}px ${palette.fontMono}`;
      ctx.fillText("HEAD", x + 6 * z, y + height / 2 + 0.5 * z);
      ctx.font = `500 ${11 * z}px ${palette.fontUi}`;
      textX = x + 35 * z;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, textX, y + height / 2 + 0.5 * z);
    y -= height + gap;
  }

  // Requests go above the refs, coloured by their state, with the pull request glyph.
  for (const pull of pulls ?? []) {
    const stateColor = pull.state === "Merged" ? palette.accent : pull.state === "Open" ? palette.success : palette.text3;
    const icon = 12 * z;
    const width = ctx.measureText(pull.label).width + 14 * z + icon;
    const x = cx - width / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fillStyle = withAlpha(stateColor, pull.state === "Draft" ? 0 : 0.16);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(stateColor, 0.55);
    if (pull.state === "Draft") ctx.setLineDash([3 * z, 2 * z]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawPullGlyph(ctx, stateColor, x + 6 * z, y + height / 2, z);
    ctx.fillStyle = stateColor;
    ctx.fillText(pull.label, x + 7 * z + icon, y + height / 2 + 0.5 * z);
    y -= height + gap;
  }
}

/** The pull request symbol (two dots joined by a line and an arrow), 10 units wide, from `x`. */
function drawPullGlyph(ctx: Ctx, color: string, x: number, cy: number, z: number): void {
  const r = 1.6 * z;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, 1.2 * z);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x + 2 * z, cy - 3 * z, r, 0, Math.PI * 2);
  ctx.moveTo(x + 2 * z + r, cy + 3 * z);
  ctx.arc(x + 2 * z, cy + 3 * z, r, 0, Math.PI * 2);
  ctx.moveTo(x + 8 * z + r, cy + 3 * z);
  ctx.arc(x + 8 * z, cy + 3 * z, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 2 * z, cy - 3 * z + r);
  ctx.lineTo(x + 2 * z, cy + 3 * z - r);
  ctx.moveTo(x + 8 * z, cy + 3 * z - r);
  ctx.lineTo(x + 8 * z, cy - 2 * z);
  ctx.quadraticCurveTo(x + 8 * z, cy - 4 * z, x + 6 * z, cy - 4 * z);
  ctx.lineTo(x + 4.5 * z, cy - 4 * z);
  ctx.moveTo(x + 5.8 * z, cy - 5.3 * z);
  ctx.lineTo(x + 4.5 * z, cy - 4 * z);
  ctx.lineTo(x + 5.8 * z, cy - 2.7 * z);
  ctx.stroke();
  ctx.restore();
}

/** `text` cut with an ellipsis so it is at most `maxWidth` wide in the current font (never squeezed). */
export function fitText(ctx: Ctx, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

/** `#rrggbb` or `rgb(...)` to `rgba(..., alpha)`. Other formats are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/** Index of the node under a screen point, or null. */
export function hitTest(
  index: GraphIndex,
  view: View,
  px: number,
  py: number,
): number | null {
  if (index.length === 0) return null;
  const wx = (px - view.tx) / view.z;
  const wy = (py - view.ty) / view.z;
  const column = Math.round(-wx / COLUMN_W);
  if (column < 0 || column >= index.length) return null;
  const row = index.rows[column];
  if (!row) return null;
  const tolerance = Math.max(HALF + 4, 6 / view.z);
  const dx = Math.abs(wx + column * COLUMN_W);
  const dy = Math.abs(wy - row.lane * LANE_H);
  return dx <= tolerance && dy <= tolerance ? column : null;
}
