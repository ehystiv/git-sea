import { describe, expect, it } from "vitest";
import { fakeIndex, type FakeCommit } from "../graph/testData";
import { fitText } from "../graph/draw";
import { hitTestTimeline, markerSize } from "./draw";
import { buildTimeline, commitsBetween, edgesBetween } from "./layout";
import { timeTicks } from "./ticks";
import {
  AXIS_H,
  BASE_ZX,
  clampTimelineView,
  fitTimeline,
  homeTimeline,
  laneY,
  MAX_ZX,
  minZoom,
  screenX,
  timeAt,
  zoomAtX,
} from "./view";

const DAY = 86400;
const W = 1000;
const H = 600;

/** Newest first: c0 at day 10 ... c10 at day 0, each commit's parent the next one. */
function line(days = 11): FakeCommit[] {
  return Array.from({ length: days }, (_, i) => ({
    id: `c${i}`,
    parents: i < days - 1 ? [`c${i + 1}`] : [],
    lane: 0,
    time: (days - 1 - i) * DAY,
  }));
}

describe("timeline data", () => {
  it("orders commits by time and tells the time range", () => {
    const data = buildTimeline(fakeIndex(line()));
    expect(data.count).toBe(11);
    expect(data.tMin).toBe(0);
    expect(data.tMax).toBe(10 * DAY);
    expect(Array.from(data.order.slice(0, 3))).toEqual([10, 9, 8]);
  });

  it("finds the commits inside a time window", () => {
    const data = buildTimeline(fakeIndex(line()));
    const { from, to } = commitsBetween(data, 2 * DAY, 4 * DAY);
    expect(Array.from(data.order.slice(from, to)).sort((a, b) => a - b)).toEqual([6, 7, 8]);
    expect(commitsBetween(data, 100 * DAY, 200 * DAY)).toEqual({ from: 11, to: 11 });
  });

  it("finds edges crossing a window even when both ends are outside it", () => {
    // Two commits a year apart: nothing is inside the window but the link crosses it.
    const index = fakeIndex([
      { id: "new", parents: ["old"], time: 365 * DAY },
      { id: "old", parents: [], time: 0 },
    ]);
    const data = buildTimeline(index);
    const seen: number[] = [];
    edgesBetween(data, 100 * DAY, 200 * DAY, (e) => seen.push(e));
    expect(seen).toHaveLength(1);
    const none: number[] = [];
    edgesBetween(data, 400 * DAY, 500 * DAY, (e) => none.push(e));
    expect(none).toHaveLength(0);
  });

  it("marks the first parent and skips parents that are not loaded", () => {
    const index = fakeIndex([
      { id: "m", parents: ["a", "b", "missing"], time: 30 },
      { id: "a", parents: [], time: 20 },
      { id: "b", parents: [], time: 10 },
    ]);
    const data = buildTimeline(index);
    expect(data.edgeCount).toBe(2);
    const firsts = Array.from(data.edgeFirst).sort();
    expect(firsts).toEqual([0, 1]);
  });

  it("gives commits without a date the time of their neighbour", () => {
    const index = fakeIndex([
      { id: "a", parents: ["b"], time: null },
      { id: "b", parents: ["c"], time: 500 },
      { id: "c", parents: ["d"], time: null },
      { id: "d", parents: [], time: 100 },
    ]);
    const data = buildTimeline(index);
    expect(Array.from(data.times)).toEqual([500, 500, 500, 100]);
    expect(data.tMin).toBe(100);
  });

  it("handles an empty history", () => {
    const data = buildTimeline(fakeIndex([]));
    expect(data.count).toBe(0);
    expect(commitsBetween(data, 0, 10)).toEqual({ from: 0, to: 0 });
  });
});

describe("timeline view", () => {
  const data = buildTimeline(fakeIndex(line()));

  it("zooms around the time under the cursor", () => {
    const view = { t0: 3 * DAY, ty: AXIS_H, zx: BASE_ZX };
    const next = zoomAtX(view, 2, 400, data, W);
    expect(next.zx).toBeCloseTo(BASE_ZX * 2);
    expect(timeAt(next, 400)).toBeCloseTo(timeAt(view, 400));
  });

  it("keeps the zoom between the whole history and one pixel per second", () => {
    const view = { t0: 0, ty: AXIS_H, zx: BASE_ZX };
    expect(zoomAtX(view, 1e9, 0, data, W).zx).toBe(MAX_ZX);
    expect(zoomAtX(view, 1e-9, 0, data, W).zx).toBeCloseTo(minZoom(data, W));
  });

  it("keeps the middle of the screen inside the history", () => {
    const far = clampTimelineView({ t0: 1e9, ty: 0, zx: BASE_ZX }, data, 1, W, H);
    expect(timeAt(far, W / 2)).toBeCloseTo(data.tMax);
    const before = clampTimelineView({ t0: -1e9, ty: 0, zx: BASE_ZX }, data, 1, W, H);
    expect(timeAt(before, W / 2)).toBeCloseTo(data.tMin);
  });

  it("fits the whole history on screen", () => {
    const view = fitTimeline(data, 1, W, H);
    expect(screenX(view, data.tMin)).toBeGreaterThanOrEqual(0);
    expect(screenX(view, data.tMax)).toBeLessThanOrEqual(W);
  });

  it("starts at the newest commits, near the right edge", () => {
    const long = buildTimeline(fakeIndex(line(200)));
    const view = homeTimeline(long, 1, W, H);
    const x = screenX(view, long.tMax);
    expect(x).toBeGreaterThan(W * 0.7);
    expect(x).toBeLessThan(W);
    // Only about the last month is shown.
    expect(timeAt(view, 0)).toBeGreaterThan(long.tMax - 40 * DAY);
  });

  it("does not scroll vertically when every lane fits", () => {
    const a = clampTimelineView({ t0: 0, ty: -500, zx: BASE_ZX }, data, 2, W, H);
    const b = clampTimelineView({ t0: 0, ty: 300, zx: BASE_ZX }, data, 2, W, H);
    expect(a.ty).toBe(b.ty);
  });

  it("scrolls vertically within the lanes when there are many", () => {
    const top = clampTimelineView({ t0: 0, ty: 1e6, zx: BASE_ZX }, data, 40, W, H).ty;
    const bottom = clampTimelineView({ t0: 0, ty: -1e6, zx: BASE_ZX }, data, 40, W, H).ty;
    expect(bottom).toBeLessThan(top);
    expect(laneY({ t0: 0, ty: bottom, zx: BASE_ZX }, 39)).toBeLessThanOrEqual(H);
  });
});

describe("timeline hit test", () => {
  const index = fakeIndex([
    { id: "a", parents: ["b"], lane: 0, time: 20 * DAY },
    { id: "b", parents: [], lane: 1, time: 20 * DAY - 60 },
  ]);
  const data = buildTimeline(index);
  const view = { t0: 20 * DAY - 500 / (BASE_ZX * 10), ty: 100, zx: BASE_ZX * 10 };

  it("finds the commit under the pointer, on its own row", () => {
    const x = screenX(view, 20 * DAY);
    expect(hitTestTimeline(data, index, view, x, laneY(view, 0))).toBe(0);
    expect(hitTestTimeline(data, index, view, x, laneY(view, 1))).toBe(1);
  });

  it("finds nothing in empty space or over the axis", () => {
    const x = screenX(view, 20 * DAY);
    expect(hitTestTimeline(data, index, view, x + 200, laneY(view, 0))).toBeNull();
    expect(hitTestTimeline(data, index, view, x, 5)).toBeNull();
  });

  it("uses smaller markers when zoomed out", () => {
    expect(markerSize({ t0: 0, ty: 0, zx: BASE_ZX * 100 })).toBeGreaterThan(markerSize({ t0: 0, ty: 0, zx: BASE_ZX / 100 }));
  });
});

describe("time ticks", () => {
  const start = new Date(2026, 0, 1).getTime() / 1000;

  it("puts months on the first of the month when zoomed out to a year", () => {
    const ticks = timeTicks(start, start + 365 * DAY, 1000 / (365 * DAY));
    expect(ticks.length).toBeGreaterThan(2);
    for (const t of ticks) expect(new Date(t.time * 1000).getDate()).toBe(1);
  });

  it("uses years for decades and keeps ticks apart", () => {
    const span = 20 * 365 * DAY;
    const pxPerSecond = 1000 / span;
    const ticks = timeTicks(start, start + span, pxPerSecond);
    expect(ticks.length).toBeGreaterThan(1);
    for (let i = 1; i < ticks.length; i++) {
      const gap = ((ticks[i]?.time ?? 0) - (ticks[i - 1]?.time ?? 0)) * pxPerSecond;
      expect(gap).toBeGreaterThanOrEqual(60);
    }
    expect(ticks.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
  });

  it("shows hours on a single day and marks midnight", () => {
    const ticks = timeTicks(start, start + DAY, 1000 / DAY);
    expect(ticks.some((t) => /^\d\d:\d\d$/.test(t.label))).toBe(true);
    expect(ticks.filter((t) => t.major).length).toBeGreaterThanOrEqual(1);
  });

  it("is sorted and never produces an unbounded list", () => {
    for (const span of [3600, DAY, 30 * DAY, 400 * DAY, 50 * 365 * DAY]) {
      const ticks = timeTicks(start, start + span, 800 / span);
      expect(ticks.length).toBeLessThan(500);
      expect(ticks.map((t) => t.time)).toEqual([...ticks.map((t) => t.time)].sort((a, b) => a - b));
    }
    expect(timeTicks(10, 10, 1)).toEqual([]);
  });
});

describe("fitText", () => {
  // A context where every character is 7 px wide.
  const ctx = { measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D;

  it("leaves text that fits alone", () => {
    expect(fitText(ctx, "origin/main", 200)).toBe("origin/main");
  });

  it("cuts long text with an ellipsis so it fits", () => {
    const text = "origin/feature/refactor-advanced-report-generation";
    const cut = fitText(ctx, text, 140);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length * 7).toBeLessThanOrEqual(140);
    expect(cut.length).toBeGreaterThan(10);
    expect(text.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it("gives just the ellipsis when there is no room", () => {
    expect(fitText(ctx, "something long", 3)).toBe("…");
  });
});
