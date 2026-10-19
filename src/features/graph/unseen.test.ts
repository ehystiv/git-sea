import { describe, expect, it } from "vitest";
import { COLUMN_W, LANE_H } from "./constants";
import { fakeIndex } from "./testData";
import { followColumn, headId, newCommitIds, newestColumn, sideOf } from "./unseen";
import type { GraphIndex } from "./GraphIndex";

const before = fakeIndex([{ id: "a" }, { id: "b" }]);
const after = fakeIndex([{ id: "n2" }, { id: "n1" }, { id: "a" }, { id: "b" }]);

describe("newCommitIds / newestColumn", () => {
  it("finds the commits a reload added, newest first", () => {
    expect(newCommitIds(before, after)).toEqual(["n2", "n1"]);
    expect(newestColumn(after, ["n1", "n2"])).toBe(0);
  });

  it("finds nothing on a first load, and forgets commits that are gone", () => {
    expect(newCommitIds(fakeIndex([]), after)).toEqual([]);
    expect(newestColumn(before, ["n1", "n2"])).toBeNull();
  });
});

describe("sideOf", () => {
  const index = fakeIndex([{ id: "a", lane: 0 }, { id: "b", lane: 3 }]);
  it("is null on screen and points the way otherwise", () => {
    expect(sideOf(index, { tx: 100, ty: 50, z: 1 }, 400, 300, 0)).toBeNull();
    // Column 0 is past the right edge when the view looks at older history.
    expect(sideOf(index, { tx: 900, ty: 50, z: 1 }, 400, 300, 0)).toBe("right");
    expect(sideOf(index, { tx: 100 - COLUMN_W * 5, ty: 50, z: 1 }, 400, 300, 0)).toBe("left");
    expect(sideOf(index, { tx: 100 + COLUMN_W, ty: 300 - 3 * LANE_H + 10, z: 1 }, 400, 300, 1)).toBe("down");
    expect(sideOf(index, { tx: 100, ty: -10, z: 1 }, 400, 300, 0)).toBe("up");
  });
});

describe("headId / followColumn", () => {
  const withHead = (index: GraphIndex, id: string | null) => {
    index.setRefs(id === null ? [] : [{ commit: id, name: "main", kind: "Head" }, { commit: "b", name: "v1", kind: "Tag" }]);
    return index;
  };

  it("finds the commit HEAD points to", () => {
    expect(headId(withHead(fakeIndex([{ id: "a" }, { id: "b" }]), "b"))).toBe("b");
    expect(headId(withHead(fakeIndex([{ id: "a" }]), null))).toBeNull();
  });

  it("follows HEAD when it moved, even with new commits elsewhere", () => {
    const old = withHead(fakeIndex([{ id: "a" }, { id: "b" }]), "a");
    const next = withHead(fakeIndex([{ id: "n" }, { id: "a" }, { id: "b" }]), "b");
    expect(followColumn(old, next, ["n"])).toBe(2);
  });

  it("follows the newest new commit when HEAD stayed", () => {
    const old = withHead(fakeIndex([{ id: "a" }, { id: "b" }]), "a");
    const next = withHead(fakeIndex([{ id: "n2" }, { id: "n1" }, { id: "a" }, { id: "b" }]), "a");
    expect(followColumn(old, next, ["n1", "n2"])).toBe(0);
    expect(followColumn(old, withHead(fakeIndex([{ id: "a" }, { id: "b" }]), "a"), [])).toBeNull();
  });
});
