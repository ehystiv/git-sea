import { describe, expect, it } from "vitest";
import { MINIMAP_H, MINIMAP_W } from "../graph/minimapMath";
import { fakeIndex } from "../graph/testData";
import { buildTimeline } from "./layout";
import { minimapLane, minimapTime, minimapX, minimapY, timelineCenteredAt, timelineMinimapGeometry, timelineViewportRect } from "./minimap";
import { AXIS_H, ROW_H } from "./view";

const DAY = 86_400;
// 100 days of history, newest first, on 3 lanes.
const index = fakeIndex(Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, parents: i < 99 ? [`c${i + 1}`] : [], lane: i % 3, time: (100 - i) * DAY })));
const data = buildTimeline(index);
const g = timelineMinimapGeometry(data, 3);

describe("timeline minimap", () => {
  it("fits the whole time range and every lane inside the minimap", () => {
    expect(minimapX(g, data.tMin)).toBeGreaterThanOrEqual(0);
    expect(minimapX(g, data.tMax)).toBeLessThanOrEqual(MINIMAP_W);
    expect(minimapX(g, data.tMax)).toBeGreaterThan(minimapX(g, data.tMin));
    expect(minimapY(g, 0)).toBeGreaterThanOrEqual(0);
    expect(minimapY(g, 2)).toBeLessThanOrEqual(MINIMAP_H);
  });

  it("goes back from minimap points to times and lanes", () => {
    expect(minimapTime(g, minimapX(g, 42 * DAY))).toBeCloseTo(42 * DAY);
    expect(minimapLane(g, minimapY(g, 1.5))).toBeCloseTo(1.5);
  });

  it("draws the visible time span and lanes as the viewport", () => {
    const view = { t0: 10 * DAY, zx: 1000 / (20 * DAY), ty: AXIS_H + 34 };
    const rect = timelineViewportRect(g, view, 1000, AXIS_H + 34 + 3 * ROW_H);
    expect(rect.x).toBeCloseTo(minimapX(g, 10 * DAY));
    expect(rect.x + rect.w).toBeCloseTo(minimapX(g, 30 * DAY));
    // All three lanes are on screen, so the rectangle covers them all.
    expect(rect.y).toBeLessThan(minimapY(g, 0));
    expect(rect.y + rect.h).toBeGreaterThan(minimapY(g, 2));
  });

  it("centres the clicked time and lane, keeping the zoom", () => {
    const view = { t0: 0, zx: 0.001, ty: 100 };
    const next = timelineCenteredAt(g, view, minimapX(g, 50 * DAY), minimapY(g, 2), 1000, 600);
    expect(next.zx).toBe(view.zx);
    expect(next.t0 + 500 / next.zx).toBeCloseTo(50 * DAY);
    expect(next.ty + 2 * ROW_H).toBeCloseTo(300);
  });
});
