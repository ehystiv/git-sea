import { describe, expect, it } from "vitest";
import type { FileBlame } from "../../lib/bindings";
import { blameRows } from "./blameModel";

const blame: FileBlame = {
  path: "new.txt",
  binary: false,
  tooLarge: false,
  lines: ["a", "b", "c", "d"],
  hunks: [
    { start: 0, len: 1, commit: "old", sourceLine: 1, sourcePath: "old.txt" },
    { start: 1, len: 2, commit: "mid", sourceLine: 2, sourcePath: null },
    { start: 3, len: 1, commit: "new", sourceLine: 4, sourcePath: null },
  ],
  commits: [
    { id: "old", summary: "create", author: "Ada", time: 100 },
    { id: "mid", summary: "edit", author: "Bob", time: 200 },
    { id: "new", summary: "after", author: "Ada", time: 300 },
  ],
};

describe("blameRows", () => {
  it("gives every line its commit, marks the first line of each run and ranks the age", () => {
    const rows = blameRows(blame);
    expect(rows.map((r) => [r.line, r.first, r.run, r.commit?.summary, r.sourcePath, r.age])).toEqual([
      [0, true, 0, "create", "old.txt", 0],
      [1, true, 1, "edit", null, 0.5],
      [2, false, 1, "edit", null, 0.5],
      [3, true, 2, "after", null, 1],
    ]);
  });

  it("treats a file written by a single commit as new", () => {
    const single: FileBlame = { ...blame, hunks: [{ start: 0, len: 4, commit: "old", sourceLine: 1, sourcePath: null }], commits: [blame.commits[0]!] };
    expect(blameRows(single).every((r) => r.age === 1)).toBe(true);
  });
});
