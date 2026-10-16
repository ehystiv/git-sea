import { describe, expect, it } from "vitest";
import { COLUMN_W, LANE_H, NODE } from "./constants";
import { hitWorktree } from "./draw";
import { fakeIndex } from "./testData";

const index = fakeIndex([{ id: "c0", lane: 1 }, { id: "c1", lane: 0 }]);
const view = { tx: 400, ty: 100, z: 1 };
/** Top right corner of c0's node, where the badge sits. */
const corner = { x: view.tx + NODE / 2, y: view.ty + LANE_H - NODE / 2 };

describe("hitWorktree", () => {
  it("hits the badge on the top right corner of the commit's node", () => {
    const marker = { id: "c0", files: 3 };
    expect(hitWorktree(index, view, marker, corner.x, corner.y)).toBe(true);
    expect(hitWorktree(index, view, marker, corner.x - 9, corner.y + 4)).toBe(true);
    // The middle of the node is the commit, not the badge.
    expect(hitWorktree(index, view, marker, view.tx, view.ty + LANE_H)).toBe(false);
  });

  it("follows the commit it is on", () => {
    const x = view.tx - COLUMN_W + NODE / 2;
    expect(hitWorktree(index, view, { id: "c1", files: 1 }, x, view.ty - NODE / 2)).toBe(true);
  });

  it("is not there without changes, or when the commit is not shown", () => {
    expect(hitWorktree(index, view, null, corner.x, corner.y)).toBe(false);
    expect(hitWorktree(index, view, { id: "c0", files: 0 }, corner.x, corner.y)).toBe(false);
    expect(hitWorktree(index, view, { id: "nope", files: 2 }, corner.x, corner.y)).toBe(false);
  });
});
