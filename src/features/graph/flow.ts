import { BRANCH_COLORS } from "./constants";
import type { Palette } from "./palette";

type Ctx = CanvasRenderingContext2D;

/** Most links collected for one frame; beyond this the view is too busy for moving dots to help. */
const MAX_LINKS = 4000;

/**
 * The links visible in a frame, as the renderer draws them, kept so dots can travel along them.
 * Every link is stored left to right: that is the way history reads (old on the left, new on the
 * right), so the dots always move from a commit towards the commits built on top of it.
 */
export class FlowLinks {
  /** Flattened (xLeft, xRight, y, colour) for straight lines. */
  straight: number[] = [];
  /** Flattened (xLeft, yLeft, xRight, yRight, colour) for the curves between two lanes. */
  curves: number[] = [];

  clear(): void {
    this.straight.length = 0;
    this.curves.length = 0;
  }

  private get full(): boolean {
    return this.straight.length / 4 + this.curves.length / 5 >= MAX_LINKS;
  }

  addStraight(x1: number, x2: number, y: number, color: number): void {
    if (this.full) return;
    this.straight.push(Math.min(x1, x2), Math.max(x1, x2), y, color);
  }

  addCurve(x1: number, y1: number, x2: number, y2: number, color: number): void {
    if (this.full) return;
    if (x1 <= x2) this.curves.push(x1, y1, x2, y2, color);
    else this.curves.push(x2, y2, x1, y1, color);
  }

  get isEmpty(): boolean {
    return this.straight.length === 0 && this.curves.length === 0;
  }
}

export interface FlowStyle {
  /** Milliseconds, from the animation frame. */
  time: number;
  /** Screen x of something fixed to the content, so the dots keep their place when panning. */
  anchor: number;
  /** Distance between two dots, in pixels. */
  spacing: number;
  /** Pixels per second. */
  speed: number;
  radius: number;
  width: number;
  height: number;
  palette: Palette;
}

/** Positions of the dots on a straight line from `xLeft` to `xRight`, calling `visit` for each. */
export function straightDots(
  xLeft: number,
  xRight: number,
  anchor: number,
  spacing: number,
  offset: number,
  visit: (x: number) => void,
): void {
  // Dots sit at anchor + offset + k * spacing; start at the first one inside the line.
  const first = Math.ceil((xLeft - anchor - offset) / spacing);
  for (let x = anchor + offset + first * spacing; x <= xRight; x += spacing) visit(x);
}

/** The point at `u` (0..1) of the cubic with horizontal tangents between two points. */
export function curvePoint(x1: number, y1: number, x2: number, y2: number, u: number): { x: number; y: number } {
  const mid = (x1 + x2) / 2;
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return { x: a * x1 + b * mid + c * mid + d * x2, y: a * y1 + b * y1 + c * y2 + d * y2 };
}

/**
 * Draws the dots and returns how many there were. They are small discs in the link's colour with
 * a faint halo, moving left to right at a steady pace.
 */
export function drawFlow(ctx: Ctx, links: FlowLinks, style: FlowStyle): number {
  const { time, anchor, spacing, speed, radius, width, height, palette } = style;
  const offset = (((speed * time) / 1000) % spacing + spacing) % spacing;
  const cores = Array.from({ length: BRANCH_COLORS }, () => new Path2D());
  const halos = Array.from({ length: BRANCH_COLORS }, () => new Path2D());
  const used = new Array<boolean>(BRANCH_COLORS).fill(false);
  let count = 0;

  const dot = (color: number, x: number, y: number) => {
    if (x < -radius * 2 || x > width + radius * 2 || y < -radius * 2 || y > height + radius * 2) return;
    const c = ((color % BRANCH_COLORS) + BRANCH_COLORS) % BRANCH_COLORS;
    cores[c]?.moveTo(x + radius, y);
    cores[c]?.arc(x, y, radius, 0, Math.PI * 2);
    halos[c]?.moveTo(x + radius * 2, y);
    halos[c]?.arc(x, y, radius * 2, 0, Math.PI * 2);
    used[c] = true;
    count++;
  };

  const s = links.straight;
  for (let i = 0; i < s.length; i += 4) {
    const xl = s[i] ?? 0;
    const xr = s[i + 1] ?? 0;
    const y = s[i + 2] ?? 0;
    if (xr < 0 || xl > width || y < -radius * 2 || y > height + radius * 2) continue;
    const color = s[i + 3] ?? 0;
    straightDots(Math.max(xl, -radius), Math.min(xr, width + radius), anchor, spacing, offset, (x) => dot(color, x, y));
  }

  const k = links.curves;
  for (let i = 0; i < k.length; i += 5) {
    const x1 = k[i] ?? 0;
    const y1 = k[i + 1] ?? 0;
    const x2 = k[i + 2] ?? 0;
    const y2 = k[i + 3] ?? 0;
    if (x2 < 0 || x1 > width) continue;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.round(length / spacing));
    // Same pace as on the straight lines, spread over the curve's length.
    const travelled = ((speed * time) / 1000 / Math.max(length, 1)) % 1;
    const color = k[i + 4] ?? 0;
    for (let j = 0; j < n; j++) {
      const p = curvePoint(x1, y1, x2, y2, (travelled + j / n) % 1);
      dot(color, p.x, p.y);
    }
  }

  ctx.globalAlpha = 0.22;
  for (let c = 0; c < BRANCH_COLORS; c++) {
    const path = halos[c];
    if (!used[c] || !path) continue;
    ctx.fillStyle = palette.branch[c] ?? palette.text3;
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  for (let c = 0; c < BRANCH_COLORS; c++) {
    const path = cores[c];
    if (!used[c] || !path) continue;
    ctx.fillStyle = palette.branch[c] ?? palette.text3;
    ctx.fill(path);
  }
  return count;
}

/** What the dots of a frame need: the links the view drew, and how the dots move along them. */
export interface FlowFrame {
  links: FlowLinks;
  style: Omit<FlowStyle, "time">;
  /** Dots stay below this y (the timeline's axis covers the band above it). */
  top: number;
}

/** About 30 frames a second: smooth enough for dots this slow. */
const FLOW_FRAME_MS = 32;

/**
 * Moves the dots on their own canvas, over the view's. The view draws its links once per change
 * and hands them over; every frame in between only redraws the dots, so moving dots never make
 * the whole graph redraw.
 */
export class FlowOverlay {
  private readonly ctx: Ctx;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame: FlowFrame | null = null;
  private drawn = false;
  private last = -Infinity;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.drawn = false;
    this.last = -Infinity;
  }

  /** The links of the view's latest frame; null when it has none, or the dots are off. */
  setFrame(frame: FlowFrame | null): void {
    this.frame = frame;
  }

  /**
   * Draws the dots at `time` when due: right away when the view has just redrawn (so the dots
   * stay on its links), otherwise at most every `FLOW_FRAME_MS`. Returns whether there are dots
   * to keep moving.
   */
  tick(time: number, viewRedrew: boolean): boolean {
    const frame = this.frame;
    if (!frame || this.width === 0) {
      this.clear();
      return false;
    }
    if (!viewRedrew && time - this.last < FLOW_FRAME_MS) return true;
    this.last = time;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, frame.top, this.width, this.height - frame.top);
    ctx.clip();
    const count = drawFlow(ctx, frame.links, { ...frame.style, time });
    ctx.restore();
    this.drawn = true;
    return count > 0;
  }

  clear(): void {
    if (!this.drawn) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawn = false;
  }
}
