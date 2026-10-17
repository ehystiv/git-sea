import { describe, expect, it, vi } from "vitest";
import type { CommitSummary } from "../../lib/bindings";
import { en } from "../../lib/i18n/en";
import { commitMenuItems, type CommitMenuActions } from "./commitMenu";

const commit: CommitSummary = { id: "0123456789abcdef0123456789abcdef01234567", summary: "feat: x", author: "A", time: 0, parents: [] };
const actions = (): CommitMenuActions => ({ copy: vi.fn(), copyMessage: vi.fn(), compare: vi.fn(), openUrl: vi.fn() });

describe("commitMenuItems", () => {
  it("always offers to copy the hashes and the message", () => {
    const items = commitMenuItems(commit, null, null, actions(), en);
    expect(items.map((i) => i.id)).toEqual(["copy-hash", "copy-short", "copy-message"]);
  });

  it("offers a comparison only with another selected commit", () => {
    expect(commitMenuItems(commit, commit.id, null, actions(), en).some((i) => i.id === "compare")).toBe(false);
    expect(commitMenuItems(commit, "other", null, actions(), en).some((i) => i.id === "compare")).toBe(true);
  });

  it("opens the commit's page on the hosting service", () => {
    const a = actions();
    const items = commitMenuItems(commit, null, { name: "GitHub", commitUrl: "https://github.com/o/r/commit/" }, a, en);
    const open = items.find((i) => i.id === "open-web");
    expect(open?.label).toBe("Open on GitHub");
    open?.run();
    expect(a.openUrl).toHaveBeenCalledWith(`https://github.com/o/r/commit/${commit.id}`);
  });

  it("copies the full and the short hash", () => {
    const a = actions();
    const items = commitMenuItems(commit, null, null, a, en);
    items[0]?.run();
    items[1]?.run();
    expect(a.copy).toHaveBeenNthCalledWith(1, commit.id);
    expect(a.copy).toHaveBeenNthCalledWith(2, "0123456");
  });
});
