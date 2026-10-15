import { describe, expect, it } from "vitest";
import { COLUMN_W, LANE_H, MAX_ZOOM, MIN_ZOOM } from "./constants";
import { hitTest } from "./draw";
import { fakeIndex } from "./testData";
import { anchorAtCentre, centeredOn, clampView, clampZoom, fitView, homeView, viewAfterReplace, zoomAt } from "./view";

const W = 1000;
const H = 600;
const history = Array.from({ length: 50 }, (_, i) => ({
  id: `c${i}`,
  parents: [`c${i + 1}`],
  lane: i % 3,
}));
const index = fakeIndex(history);

describe("zoom", () => {
  it("is clamped to the supported range", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(0.5)).toBe(0.5);
  });

  it("keeps the point under the cursor fixed", () => {
    const view = { tx: 120, ty: 80, z: 1 };
    const next = zoomAt(view, 2, 400, 300);

    expect(next.z).toBe(2);
    const worldBefore = { x: (400 - view.tx) / view.z, y: (300 - view.ty) / view.z };
    const worldAfter = { x: (400 - next.tx) / next.z, y: (300 - next.ty) / next.z };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it("does not move the view when already at the zoom limit", () => {
    const view = { tx: 10, ty: 20, z: MAX_ZOOM };
    expect(zoomAt(view, 2, 400, 300)).toEqual(view);
  });
});

describe("view placement", () => {
  it("puts the requested column in the middle of the screen", () => {
    const view = centeredOn(index, 10, 1, W, H);
    const x = -10 * COLUMN_W * view.z + view.tx;
    const y = (history[10]?.lane ?? 0) * LANE_H * view.z + view.ty;
    expect(x).toBeCloseTo(W / 2);
    expect(y).toBeCloseTo(H / 2);
  });

  it("starts with the newest commit near the right edge at full size", () => {
    const view = homeView(index, W, H);
    expect(view.z).toBe(1);
    expect(-0 * COLUMN_W + view.tx).toBeGreaterThan(W / 2);
    expect(view.tx).toBeLessThan(W);
  });

  it("fits a short history entirely and a long one only at its recent end", () => {
    const short = fitView(fakeIndex(history.slice(0, 4)), W, H);
    expect(short.z).toBe(1);

    const long = fitView(index, W, H);
    expect(long.z).toBeLessThan(1);
    // The newest column (x = 0) must be visible after fitting.
    expect(long.tx).toBeGreaterThan(0);
    expect(long.tx).toBeLessThan(W);
  });

  it("keeps the centre of the screen inside the graph", () => {
    const far = clampView({ tx: 1e9, ty: -1e9, z: 1 }, W, H, index);
    const centreX = (W / 2 - far.tx) / far.z;
    const centreY = (H / 2 - far.ty) / far.z;
    expect(centreX).toBeLessThanOrEqual(COLUMN_W / 2 + 1e-6);
    expect(centreY).toBeLessThanOrEqual(index.maxLane * LANE_H + LANE_H / 2 + 1e-6);
  });
});

describe("hitTest", () => {
  const view = centeredOn(index, 10, 1, W, H);

  it("finds the node under the pointer", () => {
    expect(hitTest(index, view, W / 2, H / 2)).toBe(10);
    expect(hitTest(index, view, W / 2 + 25, H / 2 - 25)).toBe(10);
  });

  it("returns null between nodes and outside the graph", () => {
    expect(hitTest(index, view, W / 2 + COLUMN_W / 2, H / 2)).toBeNull();
    expect(hitTest(index, view, W / 2, H / 2 + LANE_H / 2 + 20)).toBeNull();
    expect(hitTest(index, view, -5000, H / 2)).toBeNull();
    expect(hitTest(fakeIndex([]), view, 10, 10)).toBeNull();
  });
});

describe("keeping the place when the history changes", () => {
  const screenX = (view: { tx: number; z: number }, column: number) => -column * COLUMN_W * view.z + view.tx;
  const newer = (count: number) =>
    fakeIndex([
      ...Array.from({ length: count }, (_, i) => ({ id: `new${i}`, parents: [i === count - 1 ? "c0" : `new${i + 1}`], lane: 0 })),
      ...history,
    ]);

  it("remembers the commit at the centre of the screen", () => {
    const view = centeredOn(index, 20, 1, W, H);
    const anchor = anchorAtCentre(index, view, W);
    expect(anchor?.id).toBe("c20");
    expect(anchor?.column).toBe(20);
    expect(anchor?.screenX).toBeCloseTo(W / 2);
  });

  it("keeps the same commit at the same place when commits are added on top", () => {
    const view = centeredOn(index, 20, 1, W, H);
    const anchor = anchorAtCentre(index, view, W);

    const grown = newer(3);
    const after = viewAfterReplace(grown, view, anchor);

    const column = grown.indexOf("c20");
    expect(column).toBe(23);
    expect(screenX(after, column ?? 0)).toBeCloseTo(W / 2);
  });

  it("leaves the view alone when the user was following the newest commits", () => {
    const view = centeredOn(index, 0, 1, W, H);
    const anchor = anchorAtCentre(index, view, W);
    expect(viewAfterReplace(newer(2), view, anchor)).toEqual(view);
  });

  it("leaves the view alone when the anchor commit no longer exists or there is none", () => {
    const view = centeredOn(index, 20, 1, W, H);
    const anchor = anchorAtCentre(index, view, W);
    expect(viewAfterReplace(fakeIndex([{ id: "other" }]), view, anchor)).toEqual(view);
    expect(viewAfterReplace(index, view, null)).toEqual(view);
    expect(anchorAtCentre(fakeIndex([]), view, W)).toBeNull();
  });
});
