import { describe, expect, it } from "vitest";
import { ancestorEmphasis, ancestorMask, emphasisFits, maskFromIds, matchEmphasis } from "./emphasis";
import { compressIndex } from "./compress";
import { fakeIndex, laidOutIndex, type FakeCommit } from "./testData";

/**
 * Newest first. `m` merges `f2` (feature: f1 <- f2) into main (b <- m1 <- m); `s` is a side
 * branch on `m1` that nothing merges.
 *
 *   s ─────────┐
 *   m ──┬── m1 ┴── b
 *       └ f2 ─ f1 ┘
 */
const history: FakeCommit[] = [
  { id: "s", parents: ["m1"] },
  { id: "m", parents: ["m1", "f2"] },
  { id: "f2", parents: ["f1"] },
  { id: "m1", parents: ["b"] },
  { id: "f1", parents: ["b"] },
  { id: "b" },
];

const ids = (index: ReturnType<typeof laidOutIndex>, mask: Uint8Array) =>
  index.commits.filter((_, i) => mask[i]).map((c) => c.id);

describe("ancestorMask", () => {
  it("marks the commit and everything it descends from, across merges", () => {
    const index = laidOutIndex(history);
    expect(ids(index, ancestorMask(index, 1))).toEqual(["m", "f2", "m1", "f1", "b"]);
    expect(ids(index, ancestorMask(index, 0))).toEqual(["s", "m1", "b"]);
    expect(ids(index, ancestorMask(index, 5))).toEqual(["b"]);
  });

  it("is empty for a column that does not exist", () => {
    expect(ancestorMask(laidOutIndex(history), 9).every((v) => v === 0)).toBe(true);
  });

  it("follows a compressed node to the parents of the run it hides", () => {
    const line: FakeCommit[] = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, parents: i < 7 ? [`c${i + 1}`] : [] }));
    const out = compressIndex(fakeIndex(line), new Set());
    expect(ancestorMask(out, 0).every((v) => v === 1)).toBe(true);
  });
});

describe("laneEdgeEmphasis", () => {
  it("lights the links between ancestors and fades the others", () => {
    const index = laidOutIndex(history);
    const { nodes, edges, edgeStart } = ancestorEmphasis(index, 1); // ancestors of the merge m
    const lit = (column: number) =>
      index.rows[column]?.edges.map((e, k) => `${e.kind}${e.fromLane}${e.toLane}:${edges[(edgeStart[column] ?? 0) + k]}`);

    expect(nodes[0]).toBe(0);
    // s: its own link to m1 is not part of m's history.
    expect(lit(0)).toEqual(["Out00:0"]);
    // m: the lane of s passes by faded; both of m's links are lit.
    expect(lit(1)).toEqual(["Through00:0", "Out11:1", "ForkOut12:1"]);
    // f2 arrives on m's fork lane; s's lane and m's first-parent lane pass by.
    expect(lit(2)).toEqual(["Through00:0", "Through11:1", "In22:1", "Out22:1"]);
    // m1 takes in both s's lane (faded) and m's (lit).
    expect(lit(3)).toEqual(["In00:0", "MergeIn10:1", "Through22:1", "Out00:1"]);
  });

  it("lights nothing when no commit is bright", () => {
    const { edges } = ancestorEmphasis(laidOutIndex(history), 99);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((v) => v === 0)).toBe(true);
  });
});

describe("maskFromIds / matchEmphasis", () => {
  it("marks the listed commits, and the node that hides a commit", () => {
    const line: FakeCommit[] = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, parents: i < 7 ? [`c${i + 1}`] : [] }));
    const out = compressIndex(fakeIndex(line), new Set());
    expect(Array.from(maskFromIds(out, ["c4", "c7", "nope"]))).toEqual([0, 1, 1]);
    const match = matchEmphasis(out, ["c0"]);
    expect(match.edges).toBeNull();
    expect(emphasisFits(match, out)).toBe(true);
    expect(emphasisFits(match, fakeIndex(line))).toBe(false);
    expect(emphasisFits(null, out)).toBe(false);
  });
});
