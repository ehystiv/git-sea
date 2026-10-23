import { describe, expect, it } from "vitest";
import type { TreeFile } from "../../lib/bindings";
import { buildTree, filterFiles, fuzzyMatch, markedPieces, parentDirs, treeRows } from "./tree";

const file = (path: string, kind: TreeFile["kind"] = "File"): TreeFile => ({ path, kind });

const files = [
  file("README.md"),
  file("src/main.rs"),
  file("src/git/diff.rs"),
  file("src/git/blame.rs"),
  file("src/Item10.ts"),
  file("src/Item9.ts"),
  file("run.sh", "Executable"),
  file("vendor", "Submodule"),
];

describe("buildTree", () => {
  it("nests the files in their directories, directories first", () => {
    const root = buildTree(files);
    expect(root.children.map((n) => [n.name, n.kind])).toEqual([
      ["src", "Dir"],
      ["README.md", "File"],
      ["run.sh", "Executable"],
      ["vendor", "Submodule"],
    ]);
    const src = root.children[0];
    expect(src?.children.map((n) => n.path)).toEqual(["src/git", "src/Item9.ts", "src/Item10.ts", "src/main.rs"]);
    expect(src?.children[0]?.children.map((n) => n.name)).toEqual(["blame.rs", "diff.rs"]);
  });
});

describe("treeRows", () => {
  it("lists the open directories' contents, indented", () => {
    const root = buildTree(files);
    expect(treeRows(root, new Set()).map((r) => r.node.path)).toEqual(["src", "README.md", "run.sh", "vendor"]);
    const rows = treeRows(root, new Set(["src", "src/git"]));
    expect(rows.slice(0, 4).map((r) => [r.node.path, r.depth, r.open])).toEqual([
      ["src", 0, true],
      ["src/git", 1, true],
      ["src/git/blame.rs", 2, false],
      ["src/git/diff.rs", 2, false],
    ]);
    // A directory inside a closed one stays hidden even when it is marked open.
    expect(treeRows(root, new Set(["src/git"])).map((r) => r.node.path)).toEqual(["src", "README.md", "run.sh", "vendor"]);
  });
});

it("names the directories that hold a path", () => {
  expect(parentDirs("a/b/c.txt")).toEqual(["a", "a/b"]);
  expect(parentDirs("top.txt")).toEqual([]);
});

describe("fuzzyMatch", () => {
  it("needs every character, in order", () => {
    expect(fuzzyMatch("dif", "src/git/diff.rs")?.marks).toEqual([8, 9, 10]);
    expect(fuzzyMatch("fid", "src/git/diff.rs")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, marks: [] });
  });

  it("prefers the file name and runs of characters", () => {
    const name = fuzzyMatch("main", "src/main.rs");
    const scattered = fuzzyMatch("main", "src/model/animation.rs");
    expect(name && scattered && name.score > scattered.score).toBe(true);
    // From the end: the characters land in the file name, not in the directories.
    expect(fuzzyMatch("gd", "src/git/diff.rs")?.marks).toEqual([4, 8]);
    expect(fuzzyMatch("s/g/d", "src/git/diff.rs")).not.toBeNull();
  });
});

describe("filterFiles", () => {
  it("ranks the matches and stops at the limit", () => {
    expect(filterFiles(files, "git", 10).map((m) => m.file.path)).toEqual(["src/git/diff.rs", "src/git/blame.rs"]);
    expect(filterFiles(files, "main", 10)[0]?.file.path).toBe("src/main.rs");
    expect(filterFiles(files, "rs", 1)).toHaveLength(1);
    expect(filterFiles(files, "zzz", 10)).toEqual([]);
  });
});

it("splits a text into marked and plain pieces", () => {
  expect(markedPieces("diff.rs", [0, 1, 5])).toEqual([
    { text: "di", marked: true },
    { text: "ff.", marked: false },
    { text: "r", marked: true },
    { text: "s", marked: false },
  ]);
});
