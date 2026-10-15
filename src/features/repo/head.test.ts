import { describe, expect, it } from "vitest";
import { headCommitId } from "./head";

describe("headCommitId", () => {
  it("returns the commit of a branch or of a detached HEAD", () => {
    expect(headCommitId({ kind: "Branch", name: "main", commit: "abc" })).toBe("abc");
    expect(headCommitId({ kind: "Detached", commit: "def" })).toBe("def");
  });

  it("returns null when there are no commits yet", () => {
    expect(headCommitId({ kind: "Unborn", name: "main" })).toBeNull();
  });
});
