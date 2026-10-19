import { dateFormatter, formatCount } from "../../lib/format";
import { t, type Messages } from "../../lib/i18n";
import { COLUMN_W, LOD_TILE } from "../graph/constants";
import { draw, RenderCache, withAlpha, type View } from "../graph/draw";
import type { GraphIndex } from "../graph/GraphIndex";
import type { Palette } from "../graph/palette";
import type { PullBadge } from "../pulls/pulls";
import { frontierColumn, frontierX, replayArrival, replayView, revealedAt } from "./replay";

/** The graph as it is on screen when the replay starts: what it shows, and how. */
export interface ReplaySource {
  index: GraphIndex;
  view: View;
  /** CSS pixels: the part of the view that is not under the details panel, where the camera works. */
  width: number;
  height: number;
  palette: Palette;
  bookmarks: ReadonlySet<string>;
  pulls: ReadonlyMap<string, readonly PullBadge[]>;
}

const monthYear = dateFormatter({ month: "long", year: "numeric" });

/** Every column at its own place: the arrival in a replay moves nothing aside. */
let identity = new Float64Array(0);
function identityPositions(count: number): Float64Array {
  if (identity.length !== count) identity = Float64Array.from({ length: count }, (_, i) => i);
  return identity;
}

/**
 * Draws the history `ms` into a replay lasting `durationMs`: the commits up to the frontier, each
 * entering with the graph's arrival animation (its link traced, its node popping in, a ring), the
 * newer ones hidden behind a soft edge, and the date and count of the frontier in a corner.
 * `scale` is device pixels per CSS pixel of the target. `drawWidth` is how much is drawn: on screen
 * the replay also goes under the details panel, while exports keep to `source.width`.
 */
export function drawReplayFrame(
  ctx: CanvasRenderingContext2D,
  source: ReplaySource,
  cache: RenderCache,
  ms: number,
  durationMs: number,
  scale: number,
  title: string,
  m: Messages = t(),
  drawWidth: number = source.width,
): void {
  const { index, height, palette } = source;
  const width = Math.max(source.width, drawWidth);
  const total = index.length;
  const revealed = revealedAt(total, ms, durationMs);
  const frontier = frontierColumn(total, revealed);
  const view = replayView(source.view, source.width, frontier);
  const edge = frontierX(view, frontier);
  // Far out the nodes are dots, which have no animation; drawing every column one by one, as an
  // arrival does, would only cost time there.
  const arrival = view.z >= LOD_TILE ? replayArrival(total, ms, durationMs) : null;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, Math.max(0, edge), height);
  ctx.clip();
  draw(ctx, {
    width,
    height,
    dpr: scale,
    view,
    index,
    palette,
    cache,
    selected: null,
    hovered: null,
    flow: false,
    emphasis: null,
    morph: arrival && {
      positions: identityPositions(total),
      fade: arrival.fade,
      t: 1,
      arrival: { order: arrival.order, elapsed: arrival.elapsed, gentle: false, maxTrace: 1 },
    },
    worktree: null,
    ci: null,
    bookmarks: source.bookmarks,
    pulls: source.pulls,
    bob: null,
  });
  ctx.restore();

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // The links of the commits still to come fade out into the water past the frontier's node.
  const fade = arrival ? Math.max(8, COLUMN_W * view.z * 0.35) : Math.min(width * 0.12, COLUMN_W * view.z * 1.5 + 24);
  const gradient = ctx.createLinearGradient(edge - fade, 0, edge, 0);
  gradient.addColorStop(0, withAlpha(palette.canvas, 0));
  gradient.addColorStop(1, palette.canvas);
  ctx.fillStyle = gradient;
  ctx.fillRect(edge - fade, 0, fade, height);

  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  drawCaption(ctx, source, Math.round(frontier), Math.round(revealed), title, m);
}

/** The repository, the month of the frontier commit and how many commits are shown, top left. */
function drawCaption(ctx: CanvasRenderingContext2D, source: ReplaySource, column: number, shown: number, title: string, m: Messages): void {
  const { palette, index } = source;
  const time = index.commits[column]?.time ?? null;
  const pad = 20;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const lines: Array<{ text: string; font: string; color: string }> = [
    { text: title, font: `600 15px ${palette.fontUi}`, color: palette.text2 },
    { text: time === null ? "" : monthYear().format(new Date(time * 1000)), font: `700 26px ${palette.fontUi}`, color: palette.text },
    { text: m.replay.commits(formatCount(shown)), font: `500 13px ${palette.fontMono}`, color: palette.text3 },
  ];
  let y = pad;
  let widest = 0;
  for (const line of lines) {
    ctx.font = line.font;
    widest = Math.max(widest, ctx.measureText(line.text).width);
  }
  ctx.fillStyle = withAlpha(palette.canvas, 0.82);
  ctx.beginPath();
  ctx.roundRect(pad - 12, pad - 10, widest + 24, 92, 10);
  ctx.fill();
  for (const [i, line] of lines.entries()) {
    y += i === 0 ? 16 : i === 1 ? 32 : 24;
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, pad, y);
  }
}
