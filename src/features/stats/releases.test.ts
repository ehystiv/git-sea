import { describe, expect, it } from "vitest";
import type { RefLabel } from "../../lib/bindings";
import { fakeIndex } from "../graph/testData";
import { releaseStats } from "./releases";

const DAY = 86_400;
const tag = (name: string, commit: string): RefLabel => ({ name, commit, kind: "Tag" });

/**
 *   h (HEAD) - g - f (v2) - e - d (v1.1, side) ... c - b (v1) - a
 * `d` sits on a side branch merged into `f`.
 */
function history() {
  const index = fakeIndex([
    { id: "h", parents: ["g"], time: 70 * DAY, author: "Anna" },
    { id: "g", parents: ["f"], time: 60 * DAY, author: "Bruno" },
    { id: "f", parents: ["e", "d"], time: 50 * DAY, author: "Anna" },
    { id: "e", parents: ["c"], time: 40 * DAY, author: "Carla" },
    { id: "d", parents: ["c"], time: 30 * DAY, author: "Bruno" },
    { id: "c", parents: ["b"], time: 20 * DAY, author: "Anna" },
    { id: "b", parents: ["a"], time: 10 * DAY, author: "Anna" },
    { id: "a", parents: [], time: 0, author: "Bruno" },
  ]);
  index.setRefs([tag("v1", "b"), tag("v1.1", "d"), tag("v1.1-final", "d"), tag("v2", "f"), { name: "main", commit: "h", kind: "Head" }]);
  return index;
}

describe("releaseStats", () => {
  it("gives each commit to the oldest tag that holds it", () => {
    const stats = releaseStats(history(), 100 * DAY);
    expect(stats.releases.map((r) => [r.name, r.commits, r.authors, r.previous?.name ?? null, r.days])).toEqual([
      ["v2", 2, 2, "v1.1", 20],
      ["v1.1", 2, 2, "v1", 20],
      ["v1", 2, 2, null, null],
    ]);
    expect(stats.releases[1]?.aliases).toEqual(["v1.1-final"]);
  });

  it("counts what HEAD has that no tag holds, and the rhythm of the releases", () => {
    const stats = releaseStats(history(), 100 * DAY);
    expect(stats.pending).toBe(2);
    expect(stats.pendingSince).toBe(60 * DAY);
    expect(stats.medianDays).toBe(20);
    expect(stats.lastYear).toBe(3);
    expect(releaseStats(history(), 500 * DAY).lastYear).toBe(0);
  });

  it("has nothing to say without tags", () => {
    const index = fakeIndex([{ id: "a", parents: [] }]);
    index.setRefs([{ name: "main", commit: "a", kind: "Head" }]);
    expect(releaseStats(index)).toMatchObject({ releases: [], pending: 1, medianDays: null });
  });
});
