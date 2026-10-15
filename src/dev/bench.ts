// Development only. Query parameters:
//   data=<name>        file in public/dev-data (default small)
//   mode=shot|bench    render one view / time many frames
//   zoom, col, select  for mode=shot: zoom level, column to centre on, column to select
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "../styles/tokens.css";
import "../styles/global.css";
import { GraphController } from "../features/graph/GraphController";
import { GraphIndex } from "../features/graph/GraphIndex";
import { centeredOn } from "../features/graph/view";
import type { CommitSummary, GraphRow, RefLabel } from "../lib/bindings";

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

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

async function main(): Promise<void> {
  const dump = (await (await fetch(`/dev-data/${name}.json`)).json()) as Dump;
  const index = new GraphIndex();
  for (let i = 0; i < dump.commits.length; i += 2000) {
    index.appendChunk(dump.commits.slice(i, i + 2000), dump.rows.slice(i, i + 2000));
  }
  index.setRefs(dump.refs);

  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const controller = new GraphController(canvas, index, { onSelect: () => undefined, onZoom: () => undefined });
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
  }
  report(rows.join("\n"));
  document.title = "done";
}

void main();
