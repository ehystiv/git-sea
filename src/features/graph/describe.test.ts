import { describe, expect, it } from "vitest";
import { describeCommit } from "./describe";

describe("describeCommit", () => {
  it("reads the Conventional Commits type and drops the prefix from the label", () => {
    expect(describeCommit("feat(auth): add login form", 1)).toEqual({ kind: "feat", label: "add login form", prefix: "feat(auth)" });
    expect(describeCommit("fix!: crash on empty repo", 1)).toEqual({ kind: "fix", label: "crash on empty repo", prefix: "fix!" });
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

  it("takes a leading emoji out of the label, before or after the prefix", () => {
    expect(describeCommit("✨ feat(auth): add login", 1)).toEqual({ kind: "feat", label: "add login", emoji: "✨", prefix: "feat(auth)" });
    expect(describeCommit("fix: 🐛 crash on start", 1)).toEqual({ kind: "fix", label: "crash on start", emoji: "🐛", prefix: "fix" });
    expect(describeCommit("🎉 Initial commit", 0)).toEqual({ kind: "init", label: "Initial commit", emoji: "🎉" });
    expect(describeCommit("♻️ simplify the walk", 1)).toEqual({ kind: "commit", label: "simplify the walk", emoji: "♻️" });
  });

  it("reads gitmoji shortcodes and ignores unknown ones", () => {
    expect(describeCommit(":sparkles: add search", 1)).toEqual({ kind: "commit", label: "add search", emoji: "✨" });
    expect(describeCommit(":bug: fix: typo", 1)).toEqual({ kind: "fix", label: "typo", emoji: "🐛", prefix: "fix" });
    expect(describeCommit(":nope: hello", 1)).toEqual({ kind: "commit", label: ":nope: hello" });
  });

  it("keeps whole emoji sequences, and leaves merges and emoji-free messages alone", () => {
    expect(describeCommit("🧑‍💻 better dev tools", 1).emoji).toBe("🧑‍💻");
    expect(describeCommit("👍🏽 thanks", 1).emoji).toBe("👍🏽");
    expect(describeCommit("Merge branch 'x'", 2).emoji).toBeUndefined();
    expect(describeCommit("add 2 files", 1).emoji).toBeUndefined();
    expect(describeCommit("#123 fix", 1).emoji).toBeUndefined();
  });
});
