import { describe, expect, it } from "vitest";
import { compressIndex, MIN_GROUP } from "./compress";
import { fakeIndex, type FakeCommit } from "./testData";

/** Newest first: c0 <- c1 <- ... each commit's parent is the next one. */
function line(length: number, lane = 0): FakeCommit[] {
  return Array.from({ length }, (_, i) => ({ id: `c${i}`, parents: i < length - 1 ? [`c${i + 1}`] : [], lane }));
}

const none = new Set<string>();

describe("compressIndex", () => {
  it("collapses the inside of a linear run and keeps its ends", () => {
    // c0 is the tip (no children), c9 the root: both stay, c1..c8 become one node of 8 commits.
    const base = fakeIndex(line(10));
    const out = compressIndex(base, none);

    expect(out.commits.map((c) => c.id)).toEqual(["c0", "c1", "c9"]);
    expect(out.groups.get(1)).toEqual({ count: 8, oldestId: "c8" });
    expect(out.indexOf("c5")).toBe(1);
    expect(out.indexOf("c9")).toBe(2);
  });

  it("links the node to the parent of the run's oldest commit", () => {
    const out = compressIndex(fakeIndex(line(10)), none);
    expect(out.commits[1]?.parents).toEqual(["c9"]);
    expect(out.parentIndex(1)).toBe(2);
    expect(out.childIndex(2)).toBe(1);
  });

  it("leaves runs shorter than the minimum alone", () => {
    const base = fakeIndex(line(MIN_GROUP + 1)); // tip + (MIN_GROUP - 1 inner commits) + root
    const out = compressIndex(base, none);
    expect(out.length).toBe(base.length);
    expect(out.groups.size).toBe(0);
  });

  it("keeps commits that something points at", () => {
    const base = fakeIndex(line(10));
    base.setRefs([{ commit: "c5", name: "v1", kind: "Tag" }]);
    const out = compressIndex(base, none);

    expect(out.commits.map((c) => c.id)).toEqual(["c0", "c1", "c5", "c6", "c9"]);
    expect(out.groups.get(1)).toEqual({ count: 4, oldestId: "c4" });
    expect(out.groups.get(3)).toEqual({ count: 3, oldestId: "c8" });
  });

  it("breaks runs at forks and merges", () => {
    // m merges a side branch (s0 <- s1 <- s2 <- s3, forked from base b0) into main (b0 <- ... ).
    const base = fakeIndex([
      { id: "m", parents: ["a0", "s0"], lane: 0 },
      { id: "a0", parents: ["a1"], lane: 0 },
      { id: "a1", parents: ["a2"], lane: 0 },
      { id: "a2", parents: ["a3"], lane: 0 },
      { id: "s0", parents: ["s1"], lane: 1 },
      { id: "s1", parents: ["s2"], lane: 1 },
      { id: "s2", parents: ["s3"], lane: 1 },
      { id: "a3", parents: ["root"], lane: 0 }, // fork point: two children (a2 and s3)
      { id: "s3", parents: ["a3"], lane: 1 },
      { id: "root", parents: [], lane: 0 },
    ]);
    const out = compressIndex(base, none);

    // a0..a2 and s0..s2 are runs of 3 between the merge and the fork; s3 is the side branch's last commit.
    const ids = out.commits.map((c) => c.id);
    expect(ids).toContain("m");
    expect(ids).toContain("a3");
    expect(ids).toContain("root");
    expect(out.groups.size).toBeGreaterThanOrEqual(2);
    // Both runs sit on their own lanes.
    for (const [column] of out.groups) expect(out.rows[column]).toBeDefined();
  });

  it("never mixes lanes in one run", () => {
    const base = fakeIndex([
      { id: "t", parents: ["a"], lane: 0 },
      { id: "a", parents: ["b"], lane: 0 },
      { id: "b", parents: ["c"], lane: 1 },
      { id: "c", parents: ["d"], lane: 1 },
      { id: "d", parents: ["e"], lane: 1 },
      { id: "e", parents: [], lane: 1 },
    ]);
    const out = compressIndex(base, none);
    for (const [column, group] of out.groups) {
      const head = out.commits[column];
      const lane = out.rows[column]?.lane;
      expect(head).toBeDefined();
      expect(group.count).toBeGreaterThanOrEqual(MIN_GROUP);
      expect(lane).toBeDefined();
    }
    expect(out.groups.size).toBe(1);
    expect(out.groups.get(out.indexOf("b") ?? -1)?.count).toBe(3);
  });

  it("leaves expanded runs open", () => {
    const base = fakeIndex(line(10));
    const out = compressIndex(base, new Set(["c1"]));
    expect(out.length).toBe(10);
    expect(out.groups.size).toBe(0);
    expect(out.indexOf("c5")).toBe(5);
  });

  it("remembers which commits belong to an open run", () => {
    const base = fakeIndex(line(10));
    const open = compressIndex(base, new Set(["c1"]));
    expect(open.openRuns.get("c1")).toBe("c1");
    expect(open.openRuns.get("c8")).toBe("c1");
    expect(open.openRuns.has("c0")).toBe(false);
    expect(open.openRuns.has("c9")).toBe(false);
    expect(compressIndex(base, none).openRuns.size).toBe(0);
  });

  it("is stable while the history is still loading", () => {
    const all = line(40);
    const partial = compressIndex(fakeIndex(all.slice(0, 20)), none);
    const full = compressIndex(fakeIndex(all), none);
    // What was visible before keeps its place; only the open end of the run grows.
    expect(partial.commits.slice(0, 2).map((c) => c.id)).toEqual(full.commits.slice(0, 2).map((c) => c.id));
    expect(full.groups.get(1)?.count).toBe(38);
  });
});
