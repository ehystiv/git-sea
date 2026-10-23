import { describe, expect, it, vi } from "vitest";
import type { RefLabel } from "../../lib/bindings";
import { en } from "../../lib/i18n/en";
import { refMenuItems } from "./refMenu";

const head: RefLabel = { commit: "h", name: "main", kind: "Head" };
const feature: RefLabel = { commit: "f", name: "feature", kind: "Branch" };

describe("refMenuItems", () => {
  it("offers what a branch brings over HEAD, from the common base", () => {
    const actions = { compare: vi.fn(), showOnly: vi.fn() };
    const items = refMenuItems(feature, head, null, actions, en);
    expect(items.map((i) => i.id)).toEqual(["brings-head", "compare-head", "show-only"]);
    expect(items[0]?.label).toBe("What it brings over main");
    items[0]?.run();
    expect(actions.compare).toHaveBeenCalledWith("h", "f", true);
    items[1]?.run();
    expect(actions.compare).toHaveBeenLastCalledWith("h", "f", false);
  });

  it("compares with the selected commit when it is neither side", () => {
    const actions = { compare: vi.fn(), showOnly: vi.fn() };
    expect(refMenuItems(feature, head, "h", actions, en).some((i) => i.id === "brings-selected")).toBe(false);
    refMenuItems(feature, head, "s", actions, en).find((i) => i.id === "brings-selected")?.run();
    expect(actions.compare).toHaveBeenCalledWith("s", "f", true);
  });

  it("has nothing to compare for HEAD's own branch", () => {
    const items = refMenuItems(head, head, null, { compare: vi.fn(), showOnly: vi.fn() }, en);
    expect(items.map((i) => i.id)).toEqual(["show-only"]);
  });
});
