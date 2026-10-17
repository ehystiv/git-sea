import { describe, expect, it } from "vitest";
import { MAX_HISTORY, emptyHistory, go, visit, type SelectionHistory } from "./history";

const jump = () => false;
const visitAll = (ids: string[], isStep: (a: string, b: string) => boolean = jump) =>
  ids.reduce<SelectionHistory>((h, id) => visit(h, id, isStep), emptyHistory);

describe("visit", () => {
  it("records jumps and ignores the same commit twice", () => {
    const h = visitAll(["a", "b", "b", "c"]);
    expect(h).toEqual({ entries: ["a", "b", "c"], at: 2 });
  });

  it("drops the forward entries after going back", () => {
    const back = go(visitAll(["a", "b", "c"]), -1);
    expect(back && visit(back, "d", jump)).toEqual({ entries: ["a", "b", "d"], at: 2 });
  });

  it("replaces the current entry on a step, so a walk leaves one entry", () => {
    const steps = (a: string, b: string) => a.length === b.length;
    const h = visitAll(["start", "x", "y", "z"], steps);
    expect(h).toEqual({ entries: ["start", "z"], at: 1 });
  });

  it("does not make two equal entries in a row when a step comes back", () => {
    const h = visitAll(["a", "bb", "aa"], (from, to) => from.length === 2 && to.length === 2);
    expect(visit(h, "a", () => true)).toEqual({ entries: ["a"], at: 0 });
  });

  it("keeps at most MAX_HISTORY entries", () => {
    const h = visitAll(Array.from({ length: MAX_HISTORY + 5 }, (_, i) => `c${i}`));
    expect(h.entries).toHaveLength(MAX_HISTORY);
    expect(h.entries[0]).toBe("c5");
    expect(h.at).toBe(MAX_HISTORY - 1);
  });
});

describe("go", () => {
  it("moves back and forward and stops at the ends", () => {
    const h = visitAll(["a", "b"]);
    const back = go(h, -1);
    expect(back?.at).toBe(0);
    expect(back && go(back, -1)).toBeNull();
    expect(back && go(back, 1)?.at).toBe(1);
    expect(go(h, 1)).toBeNull();
  });

  it("skips commits that are gone", () => {
    const h = visitAll(["a", "b", "c"]);
    expect(go(h, -1, (id) => id !== "b")?.at).toBe(0);
    expect(go(h, -1, () => false)).toBeNull();
  });
});
