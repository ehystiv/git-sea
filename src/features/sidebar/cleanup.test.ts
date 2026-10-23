import { describe, expect, it } from "vitest";
import type { CleanupReport } from "../../lib/bindings";
import { cleanupCommand, cleanupGroups } from "./cleanup";

const ref = (name: string) => ({ name, commit: "c" });

describe("cleanup", () => {
  it("lists only the groups with something in them", () => {
    const report: CleanupReport = { goneRemote: [ref("origin/a")], goneUpstream: [], noUpstream: [ref("x")], merged: [], errors: [] };
    expect(cleanupGroups(report).map((g) => g.group)).toEqual(["goneRemote", "noUpstream"]);
  });

  it("writes the commands that would clean up, quoting odd names", () => {
    expect(cleanupCommand("goneRemote", [ref("origin/a"), ref("origin/b"), ref("upstream/c")])).toBe("git remote prune origin\ngit remote prune upstream");
    expect(cleanupCommand("merged", [ref("feature/x"), ref("it's")])).toBe(`git branch -d feature/x 'it'\\''s'`);
    expect(cleanupCommand("noUpstream", [ref("x")])).toBeNull();
  });
});
