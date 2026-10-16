import { describe, expect, it } from "vitest";
import { curvePoint, FlowLinks, straightDots } from "./flow";

function dots(xl: number, xr: number, anchor: number, spacing: number, offset: number): number[] {
  const out: number[] = [];
  straightDots(xl, xr, anchor, spacing, offset, (x) => out.push(x));
  return out;
}

describe("straightDots", () => {
  it("places dots a fixed distance apart inside the line", () => {
    const xs = dots(0, 100, 0, 30, 0);
    expect(xs).toEqual([0, 30, 60, 90]);
  });

  it("moves with the offset, staying a fixed distance apart", () => {
    const xs = dots(0, 100, 0, 30, 10);
    expect(xs).toEqual([10, 40, 70, 100]);
  });

  it("stays attached to the content: shifting the anchor by one spacing changes nothing", () => {
    expect(dots(5, 95, 30, 30, 7)).toEqual(dots(5, 95, 0, 30, 7));
  });

  it("covers lines that start away from the anchor and gives nothing for empty ones", () => {
    expect(dots(1000, 1100, 0, 40, 0)).toEqual([1000, 1040, 1080]);
    expect(dots(50, 50, 0, 40, 0)).toEqual([]);
    for (const x of dots(-35, 20, 0, 25, 3)) {
      expect(x).toBeGreaterThanOrEqual(-35);
      expect(x).toBeLessThanOrEqual(20);
    }
  });
});

describe("curvePoint", () => {
  it("runs from the left end to the right end, leaving and arriving horizontally", () => {
    expect(curvePoint(0, 10, 100, 60, 0)).toEqual({ x: 0, y: 10 });
    expect(curvePoint(0, 10, 100, 60, 1)).toEqual({ x: 100, y: 60 });
    const mid = curvePoint(0, 10, 100, 60, 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(35);
    // Close to the start it has hardly left the first lane.
    expect(curvePoint(0, 10, 100, 60, 0.05).y).toBeLessThan(11);
  });

  it("never goes backwards", () => {
    let last = -Infinity;
    for (let u = 0; u <= 1; u += 0.05) {
      const { x } = curvePoint(0, 0, 200, 80, u);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });
});

describe("FlowLinks", () => {
  it("stores every link left to right, whichever way it was given", () => {
    const links = new FlowLinks();
    links.addStraight(80, 20, 5, 1);
    links.addCurve(90, 40, 10, 0, 2);
    expect(links.straight).toEqual([20, 80, 5, 1]);
    expect(links.curves).toEqual([10, 0, 90, 40, 2]);
  });

  it("stops collecting past a limit and can be emptied", () => {
    const links = new FlowLinks();
    for (let i = 0; i < 10_000; i++) links.addStraight(0, 10, i, 0);
    expect(links.straight.length / 4).toBeLessThan(10_000);
    expect(links.isEmpty).toBe(false);
    links.clear();
    expect(links.isEmpty).toBe(true);
  });
});
