import { describe, expect, it } from "vitest";
import { describeCommit } from "./describe";

describe("describeCommit", () => {
  it("reads the Conventional Commits type and drops the prefix from the label", () => {
    expect(describeCommit("feat(auth): add login form", 1)).toEqual({ kind: "feat", label: "add login form" });
    expect(describeCommit("fix!: crash on empty repo", 1)).toEqual({ kind: "fix", label: "crash on empty repo" });
    expect(describeCommit("docs(readme): setup steps", 1).kind).toBe("docs");
    expect(describeCommit("perf: cache objects", 1).kind).toBe("perf");
  });

  it("groups build, ci, style, test and revert with chore", () => {
    for (const type of ["build", "ci", "style", "test", "revert"]) {
      expect(describeCommit(`${type}: something`, 1).kind).toBe("chore");
    }
  });

  it("uses a neutral kind when the message is not conventional", () => {
    expect(describeCommit("update stuff", 1)).toEqual({ kind: "commit", label: "update stuff" });
    expect(describeCommit("wip: later", 1).kind).toBe("commit");
  });

  it("recognises merges by their parent count and trims the usual prefix", () => {
    expect(describeCommit("Merge branch 'fix/tabs' into main", 2)).toEqual({
      kind: "merge",
      label: "fix/tabs into main",
    });
    expect(describeCommit("Octopus merge", 4).kind).toBe("merge");
  });

  it("marks root commits as init whatever their message", () => {
    expect(describeCommit("feat: first", 0).kind).toBe("init");
    expect(describeCommit("Initial commit", 0).kind).toBe("init");
  });
});
