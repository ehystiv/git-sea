import { describe, expect, it } from "vitest";
import { COLUMN_W } from "../graph/constants";
import { FRONT, HOLD_MS, frontierColumn, frontierX, gifFrames, gifSize, replayLength, replayView, revealedAt } from "./replay";

describe("revealedAt", () => {
  it("goes from one commit to all of them, then stays", () => {
    expect(revealedAt(101, 0, 10_000)).toBe(1);
    expect(revealedAt(101, 5_000, 10_000)).toBe(51);
    expect(revealedAt(101, 10_000, 10_000)).toBe(101);
    expect(revealedAt(101, replayLength(10_000), 10_000)).toBe(101);
    expect(revealedAt(101, -5, 10_000)).toBe(1);
  });

  it("handles an empty history and a zero duration", () => {
    expect(revealedAt(0, 100, 10_000)).toBe(0);
    expect(revealedAt(10, 0, 0)).toBe(10);
  });
});

describe("the camera", () => {
  const view = { tx: 0, ty: 40, z: 0.5 };

  it("starts on the oldest commit and ends on the newest", () => {
    expect(frontierColumn(100, 1)).toBe(99);
    expect(frontierColumn(100, 100)).toBe(0);
  });

  it("keeps the frontier at the same place on screen, at the zoom and height of the view", () => {
    for (const frontier of [0, 10, 99.5]) {
      const v = replayView(view, 1000, frontier);
      expect(v.z).toBe(0.5);
      expect(v.ty).toBe(40);
      // Screen x of the frontier column.
      expect(-frontier * COLUMN_W * v.z + v.tx).toBeCloseTo(1000 * FRONT);
      expect(frontierX(v, frontier)).toBeCloseTo(1000 * FRONT + COLUMN_W * 0.5 * 0.6);
    }
  });
});

describe("GIF sizes", () => {
  it("counts the frames of the whole replay and shrinks wide views", () => {
    expect(gifFrames(replayLength(10_000))).toBe(Math.ceil(((10_000 + HOLD_MS) / 1000) * 15));
    expect(gifSize(1920, 1080)).toEqual({ width: 960, height: 540, scale: 0.5 });
    expect(gifSize(640, 400)).toEqual({ width: 640, height: 400, scale: 1 });
  });
});
