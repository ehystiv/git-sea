import { describe, expect, it } from "vitest";
import { COLUMN_W } from "../graph/constants";
import { ARRIVAL, arrivalProgress } from "../graph/morph";
import { ARRIVAL_MS, FRONT, HOLD_MS, reachedAt, replayArrival, frontierColumn, frontierX, gifFrames, gifSize, replayLength, replayView, revealedAt } from "./replay";

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

describe("replayArrival", () => {
  const trace = (arrival: NonNullable<ReturnType<typeof replayArrival>>, column: number) =>
    arrivalProgress(ARRIVAL.trace, arrival.elapsed, arrival.order[column] ?? -1);

  it("starts each commit's link when the frontier reaches it", () => {
    // 101 commits in 10 s: one every 100 ms; column 100 is reached at 0, column 50 at 5 s.
    expect(reachedAt(101, 100, 10_000)).toBe(0);
    expect(reachedAt(101, 50, 10_000)).toBe(5_000);
    const arrival = replayArrival(101, 5_000, 10_000);
    if (!arrival) throw new Error("expected an arrival");
    // Just reached: its link is about to be traced.
    expect(trace(arrival, 50)).toBeCloseTo(0);
    // Reached 100 ms ago: part of its link is traced.
    expect(trace(arrival, 51)).toBeCloseTo(100 / ARRIVAL.trace.ms, 1);
    // Long settled, or past the edge: not part of the arrival.
    expect(arrival.order[50 + Math.ceil(ARRIVAL_MS / 100) + 1]).toBe(-1);
    expect(arrival.order[49]).toBe(-1);
    expect(arrival.fade[50]).toBe(1);
    expect(arrival.fade[49]).toBe(0);
  });

  it("keeps unseen the commit drawn past the frontier until it is reached", () => {
    // 50 ms before column 50 is reached, the frontier is at 50.5: column 50 is drawn, 49 is not.
    const arrival = replayArrival(101, 4_950, 10_000);
    if (!arrival) throw new Error("expected an arrival");
    expect(arrival.order[50]).toBeGreaterThanOrEqual(0);
    expect(trace(arrival, 50)).toBe(0);
    expect(arrival.order[49]).toBe(-1);
  });

  it("ends once the last commit has settled", () => {
    expect(replayArrival(101, 10_000 + ARRIVAL_MS - 1, 10_000)).not.toBeNull();
    expect(replayArrival(101, 10_000 + ARRIVAL_MS, 10_000)).toBeNull();
    expect(replayArrival(0, 0, 10_000)).toBeNull();
  });

  it("starts together the commits closer than a stagger step", () => {
    // 10 001 commits in 10 s: one per millisecond.
    const arrival = replayArrival(10_001, 5_000, 10_000);
    // Ten commits reached within 10 ms use at most two steps.
    const steps = new Set(Array.from({ length: 10 }, (_, i) => arrival?.order[5_000 + i]));
    expect(steps.size).toBeLessThanOrEqual(2);
  });
});
