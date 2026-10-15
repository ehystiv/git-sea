import type { RefLabel } from "../../lib/bindings";
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
import { describeCommit, type CommitKind, type Described } from "./describe";
import type { GraphIndex } from "./GraphIndex";
import { iconPath } from "./icons";
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
}

type Ctx = CanvasRenderingContext2D;

export function draw(ctx: Ctx, scene: Scene): void {
  const { width, height, view, index, palette } = scene;
  ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);
  drawDots(ctx, scene);

  const count = index.length;
  if (count === 0) return;

  const z = view.z;
  const xMin = -view.tx / z;
  const xMax = (width - view.tx) / z;
  const first = Math.max(0, Math.floor(-xMax / COLUMN_W) - 1);
  const last = Math.min(count - 1, Math.ceil(-xMin / COLUMN_W) + 1);
  if (first > last) return;

  const columnPx = COLUMN_W * z;
  const stride = columnPx >= MIN_COLUMN_PX ? 1 : Math.ceil(MIN_COLUMN_PX / columnPx);

  drawEdges(ctx, scene, first, last, stride);
  if (z < LOD_TILE) drawDots2(ctx, scene, first, last, stride);
  else drawNodes(ctx, scene, first, last);
  scene.cache.trim();
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

function drawEdges(ctx: Ctx, scene: Scene, first: number, last: number, stride: number): void {
  const { view, index, palette, height } = scene;
  const { tx, ty, z } = view;
  const columnPx = COLUMN_W * z;
  const halfColumn = (COLUMN_W / 2) * z;
  const halfNode = HALF * z;
  const rows = index.rows;
  const paths = Array.from({ length: BRANCH_COLORS }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS).fill(false);
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
    const centerX = -r * COLUMN_W * z + tx;
    const right = centerX + halfColumn;
    const left = centerX - halfColumn;
    const sampledLeft = left - (stride - 1) * columnPx;
    const nodeY = sy(row.lane);
    const hasIn = stride > 1 && row.edges.some((e) => e.kind === "In");

    for (const edge of row.edges) {
      const color = edge.color % BRANCH_COLORS;
      const path = paths[color];
      if (!path) continue;
      const fromY = sy(edge.fromLane);
      const toY = sy(edge.toLane);
      if (Math.max(fromY, toY) < -margin || Math.min(fromY, toY) > height + margin) continue;
      used[color] = true;

      switch (edge.kind) {
        case "Through":
          path.moveTo(right, fromY);
          path.lineTo(sampledLeft, fromY);
          break;
        case "In":
          path.moveTo(right, nodeY);
          path.lineTo(stride > 1 ? sampledLeft : centerX + halfNode, nodeY);
          break;
        case "Out":
          if (stride === 1 || !hasIn) {
            path.moveTo(centerX - halfNode, nodeY);
            path.lineTo(sampledLeft, nodeY);
          }
          break;
        case "MergeIn":
          curve(path, right, fromY, centerX + halfNode, nodeY);
          break;
        case "ForkOut":
          curve(path, centerX - halfNode, nodeY, left, toY);
          break;
      }
    }
  }

  ctx.lineWidth = Math.max(1, Math.min(2.5, 2 * z));
  ctx.lineCap = "round";
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
  const { tx, ty, z } = view;
  const size = Math.max(2, Math.min(9, NODE * z * 1.2));
  const paths = Array.from({ length: BRANCH_COLORS }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS).fill(false);

  for (let r = first - (first % stride); r <= last; r += stride) {
    const row = index.rows[r];
    if (!row) continue;
    const x = -r * COLUMN_W * z + tx;
    const y = row.lane * LANE_H * z + ty;
    if (y < -size || y > height + size) continue;
    const color = row.color % BRANCH_COLORS;
    paths[color]?.rect(x - size / 2, y - size / 2, size, size);
    used[color] = true;
  }
  for (let c = 0; c < BRANCH_COLORS; c++) {
    const path = paths[c];
    if (!used[c] || !path) continue;
    ctx.fillStyle = palette.branch[c] ?? palette.text3;
    ctx.fill(path);
  }
}

function drawNodes(ctx: Ctx, scene: Scene, first: number, last: number): void {
  const { view, index, palette, width, height, selected, hovered } = scene;
  const { tx, ty, z } = view;
  const size = NODE * z;
  const card = z >= LOD_CARD;
  const radius = 12 * z;

  for (let r = first; r <= last; r++) {
    const row = index.rows[r];
    const commit = index.commits[r];
    if (!row || !commit) continue;
    const cx = -r * COLUMN_W * z + tx;
    const cy = row.lane * LANE_H * z + ty;
    if (cx < -COLUMN_W * z || cx > width + COLUMN_W * z || cy < -size * 2 || cy > height + size * 2) {
      continue;
    }

    const color = palette.branch[row.color % BRANCH_COLORS] ?? palette.text3;
    const hasChildren = row.edges.some((e) => e.kind === "In" || e.kind === "MergeIn");
    const left = cx - size / 2;
    const top = cy - size / 2;

    ctx.beginPath();
    const leftRadius = hasChildren ? radius : size / 2;
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

    if (!card) continue;

    const described = describe(scene, r);
    drawPorts(ctx, palette, cx, cy, size, z, commit.parents.length > 0, hasChildren);
    drawIcon(ctx, palette, described.kind, row.color, cx, cy, z);
    drawLabel(ctx, scene, r, described, cx, cy + size / 2 + 8 * z);
    drawBadges(ctx, scene, index.refs.get(commit.id), row.color, cx, top - 8 * z);
  }
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
  laneColor: number,
  cx: number,
  bottom: number,
): void {
  if (!labels || labels.length === 0) return;
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
    const text = texts[i] ?? "";
    const label = shown[i];
    const isHead = label?.kind === "Head";
    const chip = isHead ? 34 * z : 0;
    const width = Math.min(COLUMN_W * z * 1.3, ctx.measureText(text).width + 14 * z + chip);
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
    ctx.fillText(text, textX, y + height / 2 + 0.5 * z, width - (textX - x) - 5 * z);
    y -= height + gap;
  }
}

/** `#rrggbb` or `rgb(...)` to `rgba(..., alpha)`. Other formats are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
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
