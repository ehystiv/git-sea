import { describe, expect, it } from "vitest";
import type { RefLabel } from "../../lib/bindings";
import { fakeIndex } from "../graph/testData";
import { branchDivergences } from "./upstream";

/** main has one commit of its own, origin/main two; topic is level with origin/topic. */
function history() {
  const index = fakeIndex([
    { id: "m", parents: ["base"] },
    { id: "o2", parents: ["o1"] },
    { id: "o1", parents: ["base"] },
    { id: "t", parents: ["base"] },
    { id: "base" },
  ]);
  const labels: RefLabel[] = [
    { commit: "m", name: "main", kind: "Head" },
    { commit: "o2", name: "origin/main", kind: "Remote" },
    { commit: "t", name: "topic", kind: "Branch" },
    { commit: "t", name: "origin/topic", kind: "Remote" },
    { commit: "base", name: "lonely", kind: "Branch" },
  ];
  index.setRefs(labels);
  return index;
}

describe("branchDivergences", () => {
  it("counts each branch against its upstream, HEAD's branch included", () => {
    const result = branchDivergences(history(), [
      { branch: "main", upstream: "origin/main" },
      { branch: "topic", upstream: "origin/topic" },
    ]);
    expect(result.get("main")).toEqual({ branch: "main", upstream: "origin/main", branchCommit: "m", upstreamCommit: "o2", ahead: 1, behind: 2 });
    expect(result.get("topic")).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("leaves out branches whose upstream is not there", () => {
    const result = branchDivergences(history(), [
      { branch: "lonely", upstream: "origin/lonely" },
      { branch: "gone", upstream: "origin/main" },
    ]);
    expect(result.size).toBe(0);
  });
});
