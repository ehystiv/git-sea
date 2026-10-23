import { describe, expect, it } from "vitest";
import type { CommitSummary } from "../../lib/bindings";
import { hasScope, hasType, parseConventional, prefixOf, typeStats } from "./conventional";

const commit = (summary: string, parents = 1): CommitSummary => ({ id: summary, summary, author: "A", time: 0, parents: Array.from({ length: parents }, (_, i) => `p${i}`) });

describe("parseConventional", () => {
  it("reads type, scope, breaking mark and description", () => {
    expect(parseConventional("feat(stats): hotspots")).toEqual({ type: "feat", scope: "stats", breaking: false, description: "hotspots" });
    expect(parseConventional("Fix!: crash")).toEqual({ type: "fix", scope: null, breaking: true, description: "crash" });
    expect(parseConventional("✨ feat(ui)!: new look")).toMatchObject({ type: "feat", scope: "ui", breaking: true });
    expect(parseConventional("chore(): empty scope")?.scope).toBeNull();
  });

  it("leaves other subjects alone", () => {
    expect(parseConventional("update stuff")).toBeNull();
    expect(parseConventional("feat:no space")).toBeNull();
    expect(parseConventional("Merge branch 'x'")).toBeNull();
  });

  it("writes the prefix back", () => {
    const parts = parseConventional("feat(stats)!: x");
    expect(parts && prefixOf(parts)).toBe("feat(stats)!");
  });
});

describe("typeStats", () => {
  it("counts types and scopes, leaving merges out", () => {
    const stats = typeStats([commit("feat(ui): a"), commit("fix(UI): b"), commit("feat: c"), commit("feat!: d"), commit("wip"), commit("feat: merged", 2)]);
    expect(stats).toEqual({
      commits: 5,
      conventional: 4,
      breaking: 1,
      types: [
        { type: "feat", commits: 3 },
        { type: "fix", commits: 1 },
      ],
      scopes: [{ scope: "ui", commits: 2 }],
    });
  });
});

it("tests a commit's type and scope", () => {
  expect(hasType(commit("feat(ui): a"), ["fix", "feat"])).toBe(true);
  expect(hasType(commit("wip"), ["feat"])).toBe(false);
  expect(hasScope(commit("feat(UI): a"), ["ui"])).toBe(true);
  expect(hasScope(commit("feat: a"), ["ui"])).toBe(false);
});
