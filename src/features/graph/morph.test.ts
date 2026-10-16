import { describe, expect, it } from "vitest";
import { compressIndex } from "./compress";
import { buildMorph, firstAtLeast, morphPositions } from "./morph";
import { fakeIndex, type FakeCommit } from "./testData";

/** c0 (tip) <- c1 <- ... <- c7 (root): c1..c6 collapse into one node at column 1. */
const line: FakeCommit[] = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, parents: i < 7 ? [`c${i + 1}`] : [] }));
const base = fakeIndex(line);
const closed = compressIndex(base, new Set());
const open = compressIndex(base, new Set(["c1"]));

describe("buildMorph", () => {
  it("opening: the run's commits slide out of the node and fade in", () => {
    const morph = buildMorph(closed, open, 0);
    expect(morph?.index).toBe(open);
    expect(Array.from(morph?.from ?? [])).toEqual([0, 1, 1, 1, 1, 1, 1, 2]);
    expect(Array.from(morph?.to ?? [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // c1 is the node's own commit, so it stays; c2..c6 come out of it.
    expect(Array.from(morph?.fade ?? [])).toEqual([0, 0, 1, 1, 1, 1, 1, 0]);
  });

  it("closing: the old projection is drawn and its commits slide into the node", () => {
    const morph = buildMorph(open, closed, 0);
    expect(morph?.index).toBe(open);
    expect(Array.from(morph?.from ?? [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Array.from(morph?.to ?? [])).toEqual([0, 1, 1, 1, 1, 1, 1, 2]);
    expect(Array.from(morph?.fade ?? [])).toEqual([0, 0, -1, -1, -1, -1, -1, 0]);
  });

  it("starts from what was on screen when the view moved", () => {
    expect(Array.from(buildMorph(closed, open, 5)?.from ?? []).slice(0, 3)).toEqual([5, 6, 6]);
    expect(Array.from(buildMorph(open, closed, 5)?.from ?? []).slice(0, 3)).toEqual([5, 6, 7]);
  });

  it("has nothing to animate when the size does not change or a side is empty", () => {
    expect(buildMorph(closed, closed, 0)).toBeNull();
    expect(buildMorph(fakeIndex([]), open, 0)).toBeNull();
  });
});

describe("morphPositions / firstAtLeast", () => {
  it("interpolates and stays sorted, so the visible range can be binary searched", () => {
    const morph = buildMorph(closed, open, 0);
    if (!morph) throw new Error("no morph");
    const half = morphPositions(morph, 0.5, new Float64Array(morph.from.length));
    expect(Array.from(half)).toEqual([0, 1, 1.5, 2, 2.5, 3, 3.5, 4.5]);
    expect(firstAtLeast(half, 2)).toBe(3);
    expect(firstAtLeast(half, 0)).toBe(0);
    expect(firstAtLeast(half, 99)).toBe(8);
  });
});
