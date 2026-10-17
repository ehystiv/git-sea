import { describe, expect, it } from "vitest";
import { BOB_MS, RIPPLE_MS, bob, ripples } from "./bob";

const curve = Array.from({ length: BOB_MS + 1 }, (_, ms) => bob(ms));

describe("bob", () => {
  it("starts and ends at rest", () => {
    expect(bob(0)).toEqual({ dy: 0, scale: 1 });
    expect(bob(BOB_MS)).toEqual({ dy: 0, scale: 1 });
    expect(Math.abs(bob(BOB_MS - 1).dy)).toBeLessThan(0.05);
  });

  it("goes down first, squeezed a little, then rises past its place", () => {
    const deepest = curve.reduce((a, b) => (b.dy > a.dy ? b : a));
    const highest = curve.reduce((a, b) => (b.dy < a.dy ? b : a));
    expect(curve.findIndex((p) => p.dy > 1)).toBeLessThan(curve.findIndex((p) => p.dy < -0.5));
    expect(deepest.dy).toBeGreaterThan(3);
    expect(deepest.dy).toBeLessThanOrEqual(5);
    expect(deepest.scale).toBeLessThan(1);
    // The rise is smaller than the dip: it is floating back, not jumping.
    expect(-highest.dy).toBeLessThan(deepest.dy);
    expect(-highest.dy).toBeGreaterThan(0.5);
  });

  it("swings less each time", () => {
    const peaks: number[] = [];
    for (let i = 1; i < curve.length - 1; i++) {
      const [a, b, c] = [curve[i - 1]?.dy ?? 0, curve[i]?.dy ?? 0, curve[i + 1]?.dy ?? 0];
      if (Math.abs(b) > Math.abs(a) && Math.abs(b) >= Math.abs(c) && Math.abs(b) > 0.05) peaks.push(Math.abs(b));
    }
    expect(peaks.length).toBeGreaterThanOrEqual(3);
    peaks.slice(1).forEach((peak, i) => expect(peak).toBeLessThan(peaks[i] ?? Infinity));
  });
});

describe("ripples", () => {
  it("sends out rings one after the other, growing and fading", () => {
    expect(ripples(0)).toEqual([]);
    expect(ripples(60)).toHaveLength(1);
    expect(ripples(400).length).toBeGreaterThanOrEqual(2);
    const early = ripples(100)[0];
    const late = ripples(500)[0];
    expect(late?.radius).toBeGreaterThan(early?.radius ?? 0);
    expect(late?.alpha).toBeLessThan(early?.alpha ?? 0);
  });

  it("starts just outside the node and is gone at the end", () => {
    expect(ripples(1)[0]?.radius).toBeGreaterThanOrEqual(0.6);
    expect(ripples(RIPPLE_MS)).toEqual([]);
  });
});
