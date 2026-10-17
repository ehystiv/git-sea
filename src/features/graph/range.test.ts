import { describe, expect, it } from "vitest";
import { compressIndex } from "./compress";
import { ONLY_A, ONLY_B, divergence, divergenceEmphasis } from "./range";
import { fakeIndex, laidOutIndex, type FakeCommit } from "./testData";

/**
 * Newest first. `local` has two commits of its own on top of `base`; `origin` has three, one of
 * them a merge of `x`, which branched from `old` (below `base`).
 *
 *   local ── l1 ──┐
 *   origin ─┬ o1 ─┴ base ── old
 *           └ x ──────────┘
 */
const history: FakeCommit[] = [
  { id: "local", parents: ["l1"] },
  { id: "origin", parents: ["o1", "x"] },
  { id: "o1", parents: ["base"] },
  { id: "x", parents: ["old"] },
  { id: "l1", parents: ["base"] },
  { id: "base", parents: ["old"] },
  { id: "old" },
];

const at = (index: ReturnType<typeof fakeIndex>, id: string) => index.indexOf(id) ?? -1;
const ids = (index: ReturnType<typeof fakeIndex>, mask: Uint8Array, flag?: number) =>
  index.commits.filter((_, i) => (flag === undefined ? mask[i] : mask[i] === flag)).map((c) => c.id);

describe("divergence", () => {
  it("counts the commits on each side, across merges", () => {
    const index = fakeIndex(history);
    const result = divergence(index, at(index, "local"), at(index, "origin"));
    expect([result.ahead, result.behind]).toEqual([2, 3]);
    expect(ids(index, result.flags, ONLY_A)).toEqual(["local", "l1"]);
    expect(ids(index, result.flags, ONLY_B)).toEqual(["origin", "o1", "x"]);
  });

  it("is symmetric", () => {
    const index = fakeIndex(history);
    const result = divergence(index, at(index, "origin"), at(index, "local"));
    expect([result.ahead, result.behind]).toEqual([3, 2]);
  });

  it("gives zero on one side when a commit descends from the other", () => {
    const index = fakeIndex(history);
    expect(divergence(index, at(index, "local"), at(index, "base"))).toMatchObject({ ahead: 2, behind: 0 });
    expect(divergence(index, at(index, "base"), at(index, "local"))).toMatchObject({ ahead: 0, behind: 2 });
    expect(divergence(index, at(index, "l1"), at(index, "l1"))).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("stops once only shared history is left", () => {
    const line: FakeCommit[] = [
      { id: "a", parents: ["b"] },
      { id: "b", parents: ["c"] },
      ...Array.from({ length: 1000 }, (_, i) => ({ id: `c${i === 0 ? "" : i}`, parents: i < 999 ? [`c${i + 1}`] : [] })),
    ];
    const index = fakeIndex(line);
    const result = divergence(index, 0, 1);
    expect([result.ahead, result.behind]).toEqual([1, 0]);
    // Nothing deep in the history was even looked at.
    expect(result.flags[500]).toBe(0);
  });

  it("ignores parents that are not loaded and columns that do not exist", () => {
    const index = fakeIndex([{ id: "a", parents: ["gone"] }, { id: "b", parents: ["gone"] }]);
    expect(divergence(index, 0, 1)).toMatchObject({ ahead: 1, behind: 1 });
    expect(divergence(index, 0, 9)).toMatchObject({ ahead: 0, behind: 0 });
  });
});

describe("divergenceEmphasis", () => {
  it("lights both sides and the end points", () => {
    const index = laidOutIndex(history);
    const result = divergence(index, at(index, "base"), at(index, "local"));
    const both = divergenceEmphasis(index, index, result, ["base", "local"]);
    expect(ids(index, both.nodes)).toEqual(["local", "l1", "base"]);
    const onlyB = divergenceEmphasis(index, index, result, ["base"], ONLY_B);
    expect(ids(index, onlyB.nodes)).toEqual(["local", "l1", "base"]);
    const onlyA = divergenceEmphasis(index, index, result, ["base"], ONLY_A);
    expect(ids(index, onlyA.nodes)).toEqual(["base"]);
  });

  it("marks the compressed node that hides a commit of the range", () => {
    const line: FakeCommit[] = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, parents: i < 7 ? [`c${i + 1}`] : [] }));
    const index = fakeIndex(line);
    const view = compressIndex(index, new Set());
    const result = divergence(index, at(index, "c0"), at(index, "c7"));
    const emphasis = divergenceEmphasis(index, view, result, ["c0", "c7"]);
    expect(emphasis.nodes.every((v) => v === 1)).toBe(true);
    expect(emphasis.nodes).toHaveLength(view.length);
  });
});
