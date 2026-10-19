import { describe, expect, it } from "vitest";
import type { RefLabel } from "../../lib/bindings";
import { containingRefs } from "./contains";
import { fakeIndex, type FakeCommit } from "./testData";

/**
 * Newest first.
 *
 *   main (HEAD), v2 ── merge ─┬─ m1 ── v1 ── base
 *   origin/feature ── f1 ─────┘             │
 *   old-release, v0.9 ──────────────────────┘
 */
const history: FakeCommit[] = [
  { id: "merge", parents: ["m1", "f1"], time: 50 },
  { id: "f1", parents: ["v1"], time: 40 },
  { id: "m1", parents: ["v1"], time: 30 },
  { id: "rel", parents: ["base"], time: 15 },
  { id: "v1", parents: ["base"], time: 20 },
  { id: "base", time: 10 },
];
const refs: RefLabel[] = [
  { commit: "merge", name: "main", kind: "Head" },
  { commit: "merge", name: "v2", kind: "Tag" },
  { commit: "merge", name: "zeta", kind: "Branch" },
  { commit: "f1", name: "origin/feature", kind: "Remote" },
  { commit: "v1", name: "v1", kind: "Tag" },
  { commit: "rel", name: "old-release", kind: "Branch" },
  { commit: "rel", name: "v0.9", kind: "Tag" },
];

function contains(id: string) {
  const index = fakeIndex(history);
  index.setRefs(refs);
  const result = containingRefs(index, index.indexOf(id) ?? -1);
  const names = (list: RefLabel[]) => list.map((r) => r.name);
  return { branches: names(result.branches), remotes: names(result.remotes), tags: names(result.tags), first: result.firstTag?.name ?? null };
}

describe("containingRefs", () => {
  it("finds the refs above a commit, with the oldest tag as its first release", () => {
    expect(contains("v1")).toEqual({ branches: ["main", "zeta"], remotes: ["origin/feature"], tags: ["v1", "v2"], first: "v1" });
  });

  it("follows merges: a commit of a merged branch is in the branch it was merged into", () => {
    expect(contains("f1")).toEqual({ branches: ["main", "zeta"], remotes: ["origin/feature"], tags: ["v2"], first: "v2" });
  });

  it("does not count refs on other lines of history", () => {
    expect(contains("m1")).toEqual({ branches: ["main", "zeta"], remotes: [], tags: ["v2"], first: "v2" });
    expect(contains("rel")).toEqual({ branches: ["old-release"], remotes: [], tags: ["v0.9"], first: "v0.9" });
  });

  it("puts HEAD's branch first and finds every ref above the root", () => {
    expect(contains("base")).toEqual({
      branches: ["main", "old-release", "zeta"],
      remotes: ["origin/feature"],
      tags: ["v0.9", "v1", "v2"],
      first: "v0.9",
    });
  });

  it("gives nothing for a commit that is not loaded", () => {
    expect(contains("missing")).toEqual({ branches: [], remotes: [], tags: [], first: null });
  });
});
