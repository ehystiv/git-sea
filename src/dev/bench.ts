// Development only. Query parameters:
//   data=<name>        file in public/dev-data (default small)
//   mode=shot|bench    render one view / time many frames
//   compress=1         show the compressed (topology) projection
//   flow=1             moving dots on the links
//   overlay=1          with flow=1: dots on their own canvas, and their own timings
//   timeline=1         show the timeline; zoom is then pixels per day, col the commit to centre on
//   zoom, col, select  for mode=shot: zoom level, column to centre on, column to select
//   ancestors=<col>    highlight the ancestors of that column
//   match=<text>       highlight the commits whose subject or author contains the text
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../styles/tokens.css";
import "../styles/global.css";
import { ancestorEmphasis, ancestorMask, matchEmphasis, type Emphasis } from "../features/graph/emphasis";
import { GraphController } from "../features/graph/GraphController";
import { matchCommits } from "../features/search/query";
import { compressIndex } from "../features/graph/compress";
import { GraphIndex } from "../features/graph/GraphIndex";
import { Minimap } from "../features/graph/MinimapOverlay";
import { centeredOn } from "../features/graph/view";
import { buildTimeline } from "../features/timeline/layout";
import { TimelineController } from "../features/timeline/TimelineController";
import { centeredOnTimeline } from "../features/timeline/view";
import { initTheme } from "../lib/theme";
import type { CommitSummary, GraphRow, RefLabel } from "../lib/bindings";

initTheme();
const params = new URLSearchParams(location.search);
const name = params.get("data") ?? "small";
const mode = params.get("mode") ?? "shot";

interface Dump {
  commits: CommitSummary[];
  rows: GraphRow[];
  refs: RefLabel[];
}

function report(text: string): void {
  const out = document.getElementById("out") as HTMLPreElement;
  out.hidden = mode === "shot";
  out.textContent = text;
  console.log(`BENCH ${text}`);
}

/** The highlight asked for in the query string, built for `index`. */
function emphasisFor(index: GraphIndex, timeline: boolean): Emphasis | null {
  const ancestors = params.get("ancestors");
  const match = params.get("match");
  if (match) return matchEmphasis(index, matchCommits(index.commits, { mode: "text", text: match }));
  if (ancestors === null) return null;
  const at = Number(ancestors);
  return timeline ? { nodes: ancestorMask(index, at), edges: null, edgeStart: null } : ancestorEmphasis(index, at);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/** Timeline screenshots (mode=shot) and frame timings (mode=bench). */
async function runTimeline(index: GraphIndex, canvas: HTMLCanvasElement): Promise<void> {
  (document.getElementById("minimap") as HTMLCanvasElement).style.display = "none";
  const controller = new TimelineController(canvas, index, { onSelect: () => undefined, onZoom: () => undefined });
  const width = window.innerWidth;
  const height = window.innerHeight;
  controller.resize(width, height, window.devicePixelRatio || 1);
  controller.setFlow(params.get("flow") === "1");
  controller.setEmphasis(emphasisFor(index, true));
  (window as unknown as { __bench: unknown }).__bench = controller;
  const built = performance.now();
  const data = buildTimeline(index);
  const buildMs = Math.round(performance.now() - built);
  controller.dataChanged();
  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 300));

  const centre = (col: number, pxPerDay: number) =>
    centeredOnTimeline({ t0: 0, ty: 0, zx: pxPerDay / 86400 }, data.times[col] ?? 0, index.rows[col]?.lane ?? 0, width, height);

  if (mode === "shot") {
    const sel = params.get("select");
    if (sel !== null) controller.select(Number(sel), false);
    controller.setView(centre(Number(params.get("col") ?? "0"), Number(params.get("zoom") ?? "100")));
    controller.render();
    document.title = "ready";
    return;
  }

  const ctx = canvas.getContext("2d");
  const rows: string[] = [`commits=${index.length} lanes=${index.maxLane + 1} viewport=${width}x${height} build=${buildMs}ms`];
  for (const pxPerDay of [3000, 300, 30, 3, 0.3, 0.03]) {
    const times: number[] = [];
    for (let k = 0; k < 40; k++) {
      const col = Math.floor(((k * 0.6180339) % 1) * index.length);
      controller.setView(centre(col, pxPerDay));
      const start = performance.now();
      controller.render();
      ctx?.getImageData(0, 0, 1, 1);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    rows.push(`${pxPerDay} px/day  p50=${percentile(times, 0.5).toFixed(1)}ms p95=${percentile(times, 0.95).toFixed(1)}ms`);
  }
  report(rows.join("\n"));
  document.title = "ready";
}

async function main(): Promise<void> {
  const dump = (await (await fetch(`/dev-data/${name}.json`)).json()) as Dump;
  const full = new GraphIndex();
  for (let i = 0; i < dump.commits.length; i += 2000) {
    full.appendChunk(dump.commits.slice(i, i + 2000), dump.rows.slice(i, i + 2000));
  }
  full.setRefs(dump.refs);
  const compressStart = performance.now();
  const compress = params.get("compress") === "1";
  const expanded = new Set<string>();
  const index = compress ? new GraphIndex() : full;
  if (compress) {
    index.replaceWith(compressIndex(full, expanded));
    console.log(`BENCH compress ${Math.round(performance.now() - compressStart)} ms: ${full.length} -> ${index.length} nodes`);
  }

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  if (params.get("timeline") === "1") {
    await runTimeline(full, canvas);
    return;
  }
  const controller = new GraphController(canvas, index, {
    onSelect: () => undefined,
    onZoom: () => undefined,
    onExpandGroup: (id) => {
      expanded.add(id);
      index.replaceWith(compressIndex(full, expanded));
    },
    onCollapseGroup: (id) => {
      expanded.delete(id);
      index.replaceWith(compressIndex(full, expanded));
    },
  });
  new Minimap(document.getElementById("minimap") as HTMLCanvasElement, index, controller);
  controller.setFlow(params.get("flow") === "1");
  const overlay = params.get("overlay") === "1" ? document.createElement("canvas") : null;
  if (overlay) {
    overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    canvas.after(overlay);
    controller.attachFlowCanvas(overlay);
  }
  controller.setEmphasis(emphasisFor(index, false));
  (window as unknown as { __bench: unknown }).__bench = controller;
  const width = window.innerWidth;
  const height = window.innerHeight;
  controller.resize(width, height, window.devicePixelRatio || 1);
  controller.dataChanged();
  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (mode === "shot") {
    const z = Number(params.get("zoom") ?? "1");
    const col = Number(params.get("col") ?? "0");
    const sel = params.get("select");
    if (sel !== null) controller.select(Number(sel), false);
    controller.setView(centeredOn(index, col, z, width, height));
    controller.render();
    document.title = "ready";
    return;
  }

  const ctx = canvas.getContext("2d");
  const rows: string[] = [`commits=${index.length} lanes=${index.maxLane + 1} viewport=${width}x${height}`];
  for (const z of [1, 0.6, 0.3, 0.15, 0.05, 0.01, 0.004]) {
    const times: number[] = [];
    for (let k = 0; k < 60; k++) {
      const col = Math.floor(((k * 0.6180339) % 1) * index.length);
      controller.setView(centeredOn(index, col, z, width, height));
      const start = performance.now();
      controller.render();
      ctx?.getImageData(0, 0, 1, 1); // forces the pending drawing to finish
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    rows.push(
      `zoom=${z} median=${percentile(times, 0.5).toFixed(2)}ms p95=${percentile(times, 0.95).toFixed(2)}ms max=${times[times.length - 1]?.toFixed(2)}ms`,
    );
    if (overlay) {
      // The frames between two redraws: only the dots move.
      const dots: number[] = [];
      const overlayCtx = overlay.getContext("2d");
      for (let k = 0; k < 60; k++) {
        const start = performance.now();
        controller.renderFlow(start);
        overlayCtx?.getImageData(0, 0, 1, 1);
        dots.push(performance.now() - start);
      }
      dots.sort((a, b) => a - b);
      rows.push(`  dots only: median=${percentile(dots, 0.5).toFixed(2)}ms p95=${percentile(dots, 0.95).toFixed(2)}ms`);
    }
  }
  report(rows.join("\n"));
  document.title = "done";
}

void main();
