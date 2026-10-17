import { describe, expect, it } from "vitest";
import { BOUNCE, bounceOffEdges, cornerPosition, dropCorner, layoutDock, springAtRest, springStep, type DockArea, type SpringState } from "./dock";

const area: DockArea = { width: 1000, height: 600, insetRight: 0, insetTop: 0, margin: 16 };
const zoom = { width: 190, height: 32 };
const minimap = { width: 220, height: 96 };

describe("cornerPosition", () => {
  it("puts the widget at each corner, inside the margins", () => {
    expect(cornerPosition("top-left", zoom, area)).toEqual({ x: 16, y: 16 });
    expect(cornerPosition("bottom-right", minimap, area)).toEqual({ x: 1000 - 16 - 220, y: 600 - 16 - 96 });
  });

  it("keeps clear of the panel on the right and of the axis at the top", () => {
    const covered = { ...area, insetRight: 400, insetTop: 30 };
    expect(cornerPosition("top-right", zoom, covered)).toEqual({ x: 1000 - 400 - 16 - 190, y: 46 });
  });
});

describe("dropCorner", () => {
  it("goes to the nearest corner", () => {
    expect(dropCorner({ x: 900, y: 40 }, zoom, area, [])).toBe("top-right");
    expect(dropCorner({ x: 30, y: 500 }, zoom, area, [])).toBe("bottom-left");
  });

  it("never lands on the other widget: it takes the next nearest corner", () => {
    const resting = { ...cornerPosition("bottom-right", minimap, area), ...minimap };
    expect(dropCorner({ x: 790, y: 560 }, zoom, area, [resting])).not.toBe("bottom-right");
    expect(dropCorner({ x: 790, y: 560 }, zoom, area, [resting])).toBe("top-right");
  });
});

describe("layoutDock", () => {
  it("keeps each widget in its corner when they fit", () => {
    const out = layoutDock(
      [
        { id: "minimap", size: minimap, corner: "bottom-right" },
        { id: "zoom", size: zoom, corner: "bottom-left" },
      ],
      area,
    );
    expect(out.get("minimap")?.corner).toBe("bottom-right");
    expect(out.get("zoom")?.corner).toBe("bottom-left");
  });

  it("moves the second widget when both want the same corner", () => {
    const out = layoutDock(
      [
        { id: "minimap", size: minimap, corner: "bottom-left" },
        { id: "zoom", size: zoom, corner: "bottom-left" },
      ],
      area,
    );
    expect(out.get("minimap")?.corner).toBe("bottom-left");
    expect(out.get("zoom")?.corner).toBe("top-left");
  });

  it("separates widgets that would overlap side by side in a narrow view", () => {
    const narrow = { ...area, insetRight: 640 };
    const out = layoutDock(
      [
        { id: "minimap", size: minimap, corner: "bottom-right" },
        { id: "zoom", size: zoom, corner: "bottom-left" },
      ],
      narrow,
    );
    const a = out.get("minimap");
    const b = out.get("zoom");
    expect(a?.corner).toBe("bottom-right");
    expect(b?.corner.startsWith("top")).toBe(true);
  });
});

describe("spring", () => {
  const run = (start: SpringState, target: number, seconds: number) => {
    let s = start;
    let furthest = start.x;
    for (let t = 0; t < seconds; t += 1 / 120) {
      s = springStep(s, target, 1 / 120, BOUNCE);
      furthest = Math.max(furthest, s.x);
    }
    return { s, furthest };
  };

  it("settles on the target", () => {
    const { s } = run({ x: 0, v: 0 }, 100, 2);
    expect(springAtRest(s, 100)).toBe(true);
  });

  it("overshoots a little before settling: the bounce", () => {
    const { furthest } = run({ x: 0, v: 0 }, 100, 1);
    expect(furthest).toBeGreaterThan(101);
    expect(furthest).toBeLessThan(130);
  });

  it("bounces off the view's edges instead of leaving it", () => {
    expect(bounceOffEdges({ x: -5, v: -800 }, 0, 100)).toEqual({ x: 0, v: 280 });
    expect(bounceOffEdges({ x: 120, v: 800 }, 0, 100)).toEqual({ x: 100, v: -280 });
    expect(bounceOffEdges({ x: 50, v: 800 }, 0, 100)).toEqual({ x: 50, v: 800 });
  });

  it("carries the speed of the throw", () => {
    const thrown = springStep({ x: 0, v: 2000 }, 0, 1 / 60);
    expect(thrown.x).toBeGreaterThan(0);
  });
});
