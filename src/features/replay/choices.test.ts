import { describe, expect, it } from "vitest";
import type { RefLabel } from "../../lib/bindings";
import { t } from "../../lib/i18n";
import { fakeIndex } from "../graph/testData";
import { replayChoices } from "./choices";

/**
 * Newest first.  main (HEAD) ── m2 ── m1 ─┬─ base (v1)
 *                 feature ── f1 ──────────┘
 */
function history() {
  const index = fakeIndex([
    { id: "m2", parents: ["m1"], time: 50, summary: "second on main" },
    { id: "f1", parents: ["base"], time: 40, summary: "feature work" },
    { id: "m1", parents: ["base"], time: 30, summary: "first on main" },
    { id: "base", time: 10, summary: "base" },
  ]);
  const refs: RefLabel[] = [
    { commit: "m2", name: "main", kind: "Head" },
    { commit: "f1", name: "feature", kind: "Branch" },
    { commit: "f1", name: "origin/feature", kind: "Remote" },
    { commit: "base", name: "v1", kind: "Tag" },
  ];
  index.setRefs(refs);
  return index;
}

describe("replayChoices", () => {
  it("ends at the branch whose tip is selected, from the first commit", () => {
    const choices = replayChoices(history(), "f1", {}, t());
    expect(choices.initialEnd).toBe("b:feature");
    expect(choices.ends.find((c) => c.key === choices.initialEnd)?.commit).toBe("f1");
    expect(choices.initialStart).toBe("first");
  });

  it("ends at the branch holding the selected commit, HEAD's first", () => {
    expect(replayChoices(history(), "m1", {}, t()).initialEnd).toBe("b:main");
    // base is in both main and feature: HEAD's branch wins.
    expect(replayChoices(history(), "base", {}, t()).initialEnd).toBe("b:main");
  });

  it("uses the commits picked from the menu", () => {
    const choices = replayChoices(history(), "m2", { start: "m1", end: "f1" }, t());
    expect(choices.initialStart).toBe("picked-start");
    expect(choices.initialEnd).toBe("picked-end");
    expect(choices.starts.find((c) => c.key === "picked-start")?.commit).toBe("m1");
    // A pick that is the selected commit is that choice.
    expect(replayChoices(history(), "m2", { end: "m2" }, t()).initialEnd).toBe("selected");
  });

  it("offers the whole history, the selection, the branches and the tags", () => {
    const choices = replayChoices(history(), "m1", {}, t());
    expect(choices.ends.map((c) => c.key)).toEqual(["all", "selected", "b:main", "b:feature", "t:v1", "r:origin/feature"]);
    expect(choices.starts.map((c) => c.key)).toEqual(["first", "selected", "t:v1", "b:main", "b:feature", "r:origin/feature"]);
    expect(choices.ends[0]?.commit).toBeNull();
  });

  it("ends at the whole history with nothing selected", () => {
    expect(replayChoices(history(), null, {}, t()).initialEnd).toBe("all");
  });
});
