import { describe, expect, it } from "vitest";
import { angleDiff, createSea, fishCount, panSea, PARALLAX, resizeSea, scareSea, stepSea, type Sea } from "./sea";

/** Repeatable "randomness". */
function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function oneFish(x: number, y: number, angle = 0): Sea {
  const sea = createSea(800, 600, seeded());
  sea.fish = [{ x, y, angle, speed: 20, size: 14, depth: 1, phase: 0, fear: 0 }];
  return sea;
}

describe("sea", () => {
  it("has more fish on a bigger screen, within limits", () => {
    expect(fishCount(400, 300)).toBe(5);
    expect(fishCount(1600, 900)).toBe(12);
    expect(createSea(1200, 800, seeded()).fish.length).toBe(fishCount(1200, 800));
  });

  it("starts with every fish on screen, swimming roughly sideways", () => {
    for (const f of createSea(1000, 700, seeded(7)).fish) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(1000);
      expect(Math.abs(Math.sin(f.angle))).toBeLessThan(0.25);
    }
  });

  it("swims away from the pointer, faster than it cruises", () => {
    const sea = oneFish(400, 300, 0);
    const pointer = { x: 430, y: 300 };
    for (let i = 0; i < 20; i++) stepSea(sea, 1 / 30, { pointer }, seeded(i + 2));
    const f = sea.fish[0];
    expect(f && Math.hypot(f.x - pointer.x, f.y - pointer.y)).toBeGreaterThan(30);
    expect(f?.fear).toBeGreaterThan(0);
  });

  it("comes back on the other side when it swims off screen", () => {
    const sea = oneFish(845, 300, 0);
    stepSea(sea, 0.1, { pointer: null }, seeded());
    expect(sea.fish[0]?.x).toBeLessThan(0);
  });

  it("follows the graph less than it moves, and darts away from new commits", () => {
    const sea = oneFish(400, 300);
    panSea(sea, 100, 0);
    expect(sea.fish[0]?.x).toBeCloseTo(400 + 100 * PARALLAX);
    scareSea(sea, [{ x: sea.fish[0]?.x ?? 0, y: 400 }]);
    // Above the commit, so it heads up and away, scared.
    expect(Math.sin(sea.fish[0]?.angle ?? 0)).toBeLessThan(0);
    expect(sea.fish[0]?.fear).toBe(1);
  });

  it("keeps the fish in proportion when the screen changes size", () => {
    const sea = oneFish(400, 300);
    const bigger = resizeSea(sea, 1600, 1200, seeded());
    expect(bigger.fish[0]?.x).toBe(800);
    expect(bigger.fish[0]?.y).toBe(600);
    expect(bigger.fish.length).toBe(fishCount(1600, 1200));
  });

  it("turns the short way round", () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2);
  });
});
