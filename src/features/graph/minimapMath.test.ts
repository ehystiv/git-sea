import { describe, expect, it } from "vitest";
import { COLUMN_W, LANE_H } from "./constants";
import { MINIMAP_H, MINIMAP_W, minimapGeometry, minimapToWorld, viewCenteredAtMinimap, viewportRect, worldToMinimap } from "./minimapMath";
import { fakeIndex } from "./testData";
import { clampView } from "./view";

const W = 1000;
const H = 600;
const long = fakeIndex(Array.from({ length: 50_000 }, (_, i) => ({ id: `c${i}`, parents: [`c${i + 1}`], lane: i % 4 })));
const short = fakeIndex(Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, parents: [`s${i + 1}`], lane: i % 2 })));

describe("minimap geometry", () => {
  it("keeps the whole history inside the minimap, newest commit on the right", () => {
    for (const index of [long, short]) {
      const g = minimapGeometry(index);
      const newest = worldToMinimap(g, 0, 0);
      const oldest = worldToMinimap(g, -(index.length - 1) * COLUMN_W, index.maxLane * LANE_H);
      expect(newest.x).toBeLessThanOrEqual(MINIMAP_W);
      expect(oldest.x).toBeGreaterThanOrEqual(0);
      expect(oldest.y).toBeLessThanOrEqual(MINIMAP_H);
      expect(newest.y).toBeGreaterThanOrEqual(0);
      expect(newest.x).toBeGreaterThan(oldest.x);
    }
  });

  it("uses one scale on both axes for short histories and squeezes long ones", () => {
    const s = minimapGeometry(short);
    expect(s.sx).toBeCloseTo(s.sy);
    const l = minimapGeometry(long);
    expect(l.sx).toBeLessThan(l.sy);
  });

  it("maps points back and forth", () => {
    const g = minimapGeometry(long);
    const p = worldToMinimap(g, -12_345 * COLUMN_W, 2 * LANE_H);
    const w = minimapToWorld(g, p.x, p.y);
    expect(w.x).toBeCloseTo(-12_345 * COLUMN_W);
    expect(w.y).toBeCloseTo(2 * LANE_H);
  });
});

describe("minimap viewport", () => {
  it("never shrinks below a visible size", () => {
    const g = minimapGeometry(long);
    const rect = viewportRect(g, { tx: W / 2, ty: H / 2, z: 1 }, W, H);
    expect(rect.w).toBeGreaterThanOrEqual(6);
    expect(rect.h).toBeGreaterThanOrEqual(6);
  });

  it("covers the whole minimap width when a short history fits the screen", () => {
    const g = minimapGeometry(short);
    const rect = viewportRect(g, { tx: W - 140, ty: H / 2, z: 0.5 }, W, H);
    const oldest = worldToMinimap(g, -(short.length - 1) * COLUMN_W, 0).x;
    expect(rect.x).toBeLessThanOrEqual(oldest);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(worldToMinimap(g, 0, 0).x);
  });

  it("centres the main view on the clicked point", () => {
    const g = minimapGeometry(long);
    const target = worldToMinimap(g, -20_000 * COLUMN_W, 2 * LANE_H);
    const view = clampView(viewCenteredAtMinimap(g, { tx: 0, ty: 0, z: 0.8 }, target.x, target.y, W, H), W, H, long);
    expect(view.z).toBe(0.8);
    expect((W / 2 - view.tx) / view.z).toBeCloseTo(-20_000 * COLUMN_W, -2);
    expect((H / 2 - view.ty) / view.z).toBeCloseTo(2 * LANE_H, 0);
  });

  it("round-trips: the rectangle of the resulting view is centred on the click", () => {
    const g = minimapGeometry(long);
    const view = viewCenteredAtMinimap(g, { tx: 0, ty: 0, z: 1 }, 100, 40, W, H);
    const rect = viewportRect(g, view, W, H);
    expect(rect.x + rect.w / 2).toBeCloseTo(100);
    expect(rect.y + rect.h / 2).toBeCloseTo(40);
  });
});
