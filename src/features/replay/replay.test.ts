import { describe, expect, it } from "vitest";
import { COLUMN_W } from "../graph/constants";
import { ARRIVAL, arrivalProgress } from "../graph/morph";
import {
  ARRIVAL_MS,
  FRONT,
  HOLD_MS,
  SPEEDS,
  defaultSpeed,
  durationFor,
  formatClock,
  frontierAt,
  gifFrames,
  gifSize,
  reachedAt,
  replayArrival,
  replayLength,
  replayView,
  revealedColumn,
} from "./replay";

describe("the pace", () => {
  it("brings the commits in at the chosen speed", () => {
    expect(durationFor(100, 10)).toBe(10_000);
    expect(durationFor(0, 10)).toBe(0);
    expect(replayLength(10_000)).toBe(10_000 + HOLD_MS);
  });

  it("writes times as minutes and seconds", () => {
    expect(formatClock(4_600)).toBe("0:05");
    expect(formatClock(100_000)).toBe("1:40");
    expect(formatClock(-1)).toBe("0:00");
  });

  it("starts slow enough to follow, and fast enough to end in about half a minute", () => {
    expect(defaultSpeed(20)).toBe(1);
    expect(defaultSpeed(100)).toBe(5);
    expect(defaultSpeed(50_000)).toBe(SPEEDS[SPEEDS.length - 1]);
  });
});

describe("frontierAt", () => {
  it("walks from the start column to the newest commit, then stays", () => {
    expect(frontierAt(100, 0, 10_000)).toBe(100);
    expect(frontierAt(100, 5_000, 10_000)).toBe(50);
    expect(frontierAt(100, 10_000, 10_000)).toBe(0);
    expect(frontierAt(100, replayLength(10_000), 10_000)).toBe(0);
    expect(frontierAt(100, -5, 10_000)).toBe(100);
  });

  it("handles a replay with nothing to bring in", () => {
    expect(frontierAt(0, 100, 0)).toBe(0);
    expect(frontierAt(10, 0, 0)).toBe(0);
  });
});

describe("the camera", () => {
  const view = { tx: 0, ty: 40, z: 0.5 };

  it("keeps the frontier at the same place on screen, at the zoom and height of the view", () => {
    for (const frontier of [0, 10, 99.5]) {
      const v = replayView(view, 1000, frontier);
      expect(v.z).toBe(0.5);
      expect(v.ty).toBe(40);
      expect(-frontier * COLUMN_W * v.z + v.tx).toBeCloseTo(1000 * FRONT);
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
  const pop = (arrival: NonNullable<ReturnType<typeof replayArrival>>, column: number) =>
    arrivalProgress(ARRIVAL.pop, arrival.elapsed, arrival.order[column] ?? -1);

  it("starts popping each commit in when the frontier reaches it", () => {
    // From column 100 in 10 s: one commit every 100 ms; column 50 is reached at 5 s.
    expect(reachedAt(100, 100, 10_000)).toBe(0);
    expect(reachedAt(100, 50, 10_000)).toBe(5_000);
    const arrival = replayArrival(101, 100, 5_000, 10_000);
    if (!arrival) throw new Error("expected an arrival");
    // Just reached: about to pop in.
    expect(pop(arrival, 50)).toBeCloseTo(0);
    // Reached 100 ms ago: popping in.
    expect(pop(arrival, 51)).toBeCloseTo(100 / ARRIVAL.pop.ms, 1);
    // Long settled, or not reached yet: not part of the arrival.
    expect(arrival.order[50 + Math.ceil(ARRIVAL_MS / 100) + 1]).toBe(-1);
    expect(arrival.order[49]).toBe(-1);
    expect(arrival.fade[50]).toBe(1);
    expect(arrival.fade[49]).toBe(0);
  });

  it("leaves still the commits that are there from the start", () => {
    // Replayed from column 40 of 101: the commit at 40 and the older ones never move.
    const arrival = replayArrival(101, 40, 100, 4_000);
    expect(arrival?.order[40]).toBe(-1);
    expect(arrival?.order[39]).toBeGreaterThanOrEqual(0);
    expect(replayArrival(101, 40, 0, 4_000)).toBeNull();
  });

  it("draws a commit only once the frontier has reached it", () => {
    expect(revealedColumn(50.5)).toBe(51);
    expect(revealedColumn(50)).toBe(50);
    expect(revealedColumn(0)).toBe(0);
    // 50 ms before column 50 is reached, only 51 and older are drawn and moving.
    const arrival = replayArrival(101, 100, 4_950, 10_000);
    expect(arrival?.order[51]).toBeGreaterThanOrEqual(0);
    expect(arrival?.order[50]).toBe(-1);
  });

  it("ends once the last commit has settled", () => {
    expect(replayArrival(101, 100, 10_000 + ARRIVAL_MS - 1, 10_000)).not.toBeNull();
    expect(replayArrival(101, 100, 10_000 + ARRIVAL_MS, 10_000)).toBeNull();
    expect(replayArrival(0, 0, 0, 10_000)).toBeNull();
  });

  it("starts together the commits closer than a stagger step", () => {
    // From column 10 000 in 10 s: one commit per millisecond.
    const arrival = replayArrival(10_001, 10_000, 5_000, 10_000);
    // Ten commits reached within 10 ms use at most two steps.
    const steps = new Set(Array.from({ length: 10 }, (_, i) => arrival?.order[5_000 + i]));
    expect(steps.size).toBeLessThanOrEqual(2);
  });
});
