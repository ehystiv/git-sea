import { describe, expect, it } from "vitest";
import { GraphIndex } from "./GraphIndex";
import { fakeIndex } from "./testData";

// m (merge of a and b) → a → base, b → base; newest first.
const history = [
  { id: "m", parents: ["a", "b"], lane: 0 },
  { id: "b", parents: ["base"], lane: 1 },
  { id: "a", parents: ["base"], lane: 0 },
  { id: "base", parents: [], lane: 0 },
];

describe("GraphIndex", () => {
  it("finds the first parent and the nearest child", () => {
    const index = fakeIndex(history);

    expect(index.parentIndex(0)).toBe(2); // m → a
    expect(index.parentIndex(1)).toBe(3); // b → base
    expect(index.parentIndex(3)).toBeNull(); // root

    expect(index.childIndex(3)).toBe(2); // base → a (same lane, nearest)
    expect(index.childIndex(2)).toBe(0); // a → m
    expect(index.childIndex(1)).toBe(0); // b → m, the only child
    expect(index.childIndex(0)).toBeNull(); // tip
  });

  it("returns null for a parent that has not been loaded yet", () => {
    const index = fakeIndex(history.slice(0, 2));
    expect(index.parentIndex(0)).toBeNull();
    expect(index.parentIndex(1)).toBeNull();
  });

  it("keeps chunks appended one after the other consistent", () => {
    const whole = fakeIndex(history);
    const split = new GraphIndex();
    const first = fakeIndex(history.slice(0, 2));
    const second = fakeIndex(history.slice(2));
    split.appendChunk(first.commits, first.rows);
    split.appendChunk(second.commits, second.rows);

    expect(split.length).toBe(whole.length);
    expect(split.parentIndex(0)).toBe(whole.parentIndex(0));
    expect(split.childIndex(3)).toBe(whole.childIndex(3));
  });

  it("tracks the highest lane, including edge targets", () => {
    const index = new GraphIndex();
    index.appendChunk(
      [{ id: "x", summary: "x", author: "t", time: 0, parents: [] }],
      [{ lane: 1, color: 0, edges: [{ fromLane: 1, toLane: 3, kind: "ForkOut", color: 0 }] }],
    );
    expect(index.maxLane).toBe(3);
  });

  it("groups ref labels by commit and forgets everything on reset", () => {
    const index = fakeIndex(history);
    index.setRefs([
      { commit: "m", name: "main", kind: "Head" },
      { commit: "m", name: "origin/main", kind: "Remote" },
      { commit: "base", name: "v1", kind: "Tag" },
    ]);

    expect(index.refs.get("m")?.map((r) => r.name)).toEqual(["main", "origin/main"]);
    expect(index.refs.get("base")).toHaveLength(1);

    index.reset();
    expect(index.length).toBe(0);
    expect(index.refs.size).toBe(0);
    expect(index.maxLane).toBe(0);
  });

  it("takes over another index and tells listeners before and after", () => {
    const index = fakeIndex(history);
    const calls: string[] = [];
    const stop = index.onReplace({
      before: () => calls.push(`before:${index.length}`),
      after: () => calls.push(`after:${index.length}`),
    });

    // A new commit on top, as after `git commit`.
    const next = fakeIndex([{ id: "n", parents: ["m"], lane: 0 }, ...history]);
    index.replaceWith(next);

    expect(calls).toEqual(["before:4", "after:5"]);
    expect(index.indexOf("m")).toBe(1);
    expect(index.parentIndex(0)).toBe(1);
    expect(index.childIndex(1)).toBe(0);

    stop();
    index.replaceWith(fakeIndex(history));
    expect(calls).toHaveLength(2);
  });
});
