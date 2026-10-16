/**
 * The sea behind the graph: a few line-drawn fish and bubbles, in screen pixels. Fish wander
 * mostly sideways, keep loosely together, dart away from the pointer and from new commits, and
 * drift with the graph a little less than it moves (they are further away). Pure functions, so
 * the behaviour can be tested; `SeaLayer` runs them.
 */

export interface Fish {
  x: number;
  y: number;
  /** Heading in radians; 0 swims right. */
  angle: number;
  /** Cruising speed, pixels per second. */
  speed: number;
  /** Length in pixels. */
  size: number;
  /** 0.5 (far) to 1 (near): how much it follows the graph, and how visible it is. */
  depth: number;
  /** Tail beat. */
  phase: number;
  /** 0 calm to 1 scared: speeds it up for a moment. */
  fear: number;
}

export interface Bubble {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

export interface Sea {
  width: number;
  height: number;
  fish: Fish[];
  bubbles: Bubble[];
}

export interface SeaInput {
  /** The pointer over the canvas, or null when it is elsewhere. */
  pointer: { x: number; y: number } | null;
}

type Rand = () => number;

/** How far fish can tell the pointer is there, and how close they keep to each other. */
const FLEE_RADIUS = 110;
const SCHOOL_RADIUS = 90;
const PERSONAL_SPACE = 26;
/** Off-screen margin before a fish comes back on the other side. */
const MARGIN = 40;
/** How much of the graph's movement the nearest fish follow. */
export const PARALLAX = 0.35;

/** One fish per this many square pixels, within limits. */
export function fishCount(width: number, height: number): number {
  return Math.max(5, Math.min(12, Math.round((width * height) / 90_000)));
}

export function createSea(width: number, height: number, rand: Rand = Math.random): Sea {
  const fish = Array.from({ length: fishCount(width, height) }, (): Fish => {
    const right = rand() < 0.5;
    return {
      x: rand() * width,
      y: height * (0.1 + rand() * 0.8),
      angle: (right ? 0 : Math.PI) + (rand() - 0.5) * 0.4,
      speed: 14 + rand() * 14,
      size: 11 + rand() * 7,
      depth: 0.5 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
      fear: 0,
    };
  });
  const bubbles = Array.from({ length: 8 }, (): Bubble => newBubble(width, height, rand, rand() * height));
  return { width, height, fish, bubbles };
}

function newBubble(width: number, height: number, rand: Rand, y = height + 10): Bubble {
  return { x: rand() * width, y, r: 1.5 + rand() * 2.5, speed: 10 + rand() * 16, phase: rand() * Math.PI * 2 };
}

/** The sea at a new size: fish keep their place, in proportion. */
export function resizeSea(sea: Sea, width: number, height: number, rand: Rand = Math.random): Sea {
  if (sea.width === 0 || sea.height === 0) return createSea(width, height, rand);
  const sx = width / sea.width;
  const sy = height / sea.height;
  const fish = sea.fish.map((f) => ({ ...f, x: f.x * sx, y: f.y * sy }));
  const count = fishCount(width, height);
  const more = createSea(width, height, rand).fish;
  while (fish.length < count) fish.push(more[fish.length % more.length] as Fish);
  return { width, height, fish: fish.slice(0, count), bubbles: sea.bubbles.map((b) => ({ ...b, x: b.x * sx, y: b.y * sy })) };
}

/** Signed smallest turn from `from` to `to`, in (-π, π]. */
export function angleDiff(to: number, from: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Advances the sea by `dt` seconds. */
export function stepSea(sea: Sea, dt: number, input: SeaInput, rand: Rand = Math.random): void {
  const { width, height, fish } = sea;
  for (const f of fish) {
    let turn = (rand() - 0.5) * 0.8 * dt;

    // Loosely in a school: head the way the neighbours go, without bumping into them.
    let ax = 0;
    let ay = 0;
    let near = 0;
    for (const o of fish) {
      if (o === f) continue;
      const dx = o.x - f.x;
      const dy = o.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > SCHOOL_RADIUS) continue;
      ax += Math.cos(o.angle);
      ay += Math.sin(o.angle);
      near++;
      if (d < PERSONAL_SPACE && d > 0) turn += angleDiff(Math.atan2(-dy, -dx), f.angle) * 1.5 * dt;
    }
    if (near > 0) turn += angleDiff(Math.atan2(ay, ax), f.angle) * 0.6 * dt;

    // Fish swim mostly sideways: lean back towards horizontal when climbing or diving too steeply.
    const level = Math.cos(f.angle) >= 0 ? 0 : Math.PI;
    const tilt = angleDiff(level, f.angle);
    if (Math.abs(tilt) > 0.45) turn += tilt * 0.8 * dt;

    // Away from the pointer.
    if (input.pointer) {
      const dx = f.x - input.pointer.x;
      const dy = f.y - input.pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < FLEE_RADIUS) {
        turn += angleDiff(Math.atan2(dy, dx), f.angle) * 5 * dt;
        f.fear = Math.max(f.fear, 1 - d / FLEE_RADIUS);
      }
    }

    f.angle += turn;
    f.fear = Math.max(0, f.fear - dt * 0.7);
    const speed = f.speed * (1 + f.fear * 4);
    f.x += Math.cos(f.angle) * speed * dt;
    f.y += Math.sin(f.angle) * speed * dt;
    f.phase += dt * (5 + speed * 0.12);
    wrap(f, width, height);
  }

  for (let i = 0; i < sea.bubbles.length; i++) {
    const b = sea.bubbles[i] as Bubble;
    b.y -= b.speed * dt;
    b.phase += dt * 2;
    b.x += Math.sin(b.phase) * 6 * dt;
    if (b.y < -10) sea.bubbles[i] = newBubble(width, height, rand);
  }
}

function wrap(p: { x: number; y: number }, width: number, height: number): void {
  if (p.x < -MARGIN) p.x += width + MARGIN * 2;
  else if (p.x > width + MARGIN) p.x -= width + MARGIN * 2;
  if (p.y < -MARGIN) p.y += height + MARGIN * 2;
  else if (p.y > height + MARGIN) p.y -= height + MARGIN * 2;
}

/** The graph moved by (dx, dy) pixels: the sea follows, less for the fish further away. */
export function panSea(sea: Sea, dx: number, dy: number): void {
  for (const f of sea.fish) {
    f.x += dx * PARALLAX * f.depth;
    f.y += dy * PARALLAX * f.depth;
    wrap(f, sea.width, sea.height);
  }
  for (const b of sea.bubbles) {
    b.x += dx * PARALLAX * 0.5;
    wrap(b, sea.width, sea.height);
  }
}

/** Something happened at these points (new commits): the fish nearby dart away. */
export function scareSea(sea: Sea, points: ReadonlyArray<{ x: number; y: number }>, radius = 320): void {
  for (const f of sea.fish) {
    for (const p of points) {
      const dx = f.x - p.x;
      const dy = f.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      f.angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.4;
      f.fear = 1;
      break;
    }
  }
}

export interface SeaColors {
  ink: string;
}

/** Draws the sea on a transparent canvas whose transform already maps CSS pixels. */
export function drawSea(ctx: CanvasRenderingContext2D, sea: Sea, colors: SeaColors): void {
  ctx.clearRect(0, 0, sea.width, sea.height);
  ctx.strokeStyle = colors.ink;
  ctx.fillStyle = colors.ink;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  for (const b of sea.bubbles) {
    ctx.moveTo(b.x + b.r, b.y);
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  }
  ctx.stroke();

  ctx.lineWidth = 1.2;
  for (const f of sea.fish) {
    ctx.globalAlpha = 0.16 + 0.2 * f.depth;
    drawFish(ctx, f);
  }
  ctx.globalAlpha = 1;
}

function drawFish(ctx: CanvasRenderingContext2D, f: Fish): void {
  const l = f.size;
  const h = l * 0.32;
  const base = -l * 0.45;
  const beat = Math.sin(f.phase) * 0.35;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(f.angle);
  ctx.beginPath();
  ctx.moveTo(l * 0.55, 0);
  ctx.quadraticCurveTo(0, -h, base, 0);
  ctx.quadraticCurveTo(0, h, l * 0.55, 0);
  // The tail, beating around where it meets the body.
  const tail = l * 0.32;
  const spread = l * 0.24;
  const cos = Math.cos(beat);
  const sin = Math.sin(beat);
  const point = (x: number, y: number) => [base + x * cos - y * sin, x * sin + y * cos] as const;
  const [ux, uy] = point(-tail, -spread);
  const [lx, ly] = point(-tail, spread);
  ctx.moveTo(base, 0);
  ctx.lineTo(ux, uy);
  ctx.lineTo(lx, ly);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(l * 0.3, -h * 0.22, Math.max(0.8, l * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
