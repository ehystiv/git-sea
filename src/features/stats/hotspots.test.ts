import { describe, expect, it } from "vitest";
import type { CommitSummary, FileActivity } from "../../lib/bindings";
import { dirTrail, filesByCommit, hotspots, pathSearch } from "./hotspots";

const commit = (id: string, author: string, time: number | null, coAuthors?: string[]): CommitSummary => ({ id, summary: id, author, time, parents: [], coAuthors });

const activity: FileActivity = {
  paths: ["src/a.ts", "src/b.ts", "src/lib/c.ts", "README.md"],
  commits: [
    { id: "c3", files: [0, 1] },
    { id: "c2", files: [0, 2] },
    { id: "c1", files: [3, 0] },
    { id: "gone", files: [3] },
  ],
};
const commits = [commit("c3", "Anna", 300), commit("c2", "Bruno", 200, ["Anna"]), commit("c1", "Anna", null), commit("m", "Carla", 400)];

describe("hotspots", () => {
  const files = filesByCommit(activity);

  it("ranks what is right inside a directory, counting a commit once per directory", () => {
    const root = hotspots(commits, files, "");
    expect(root.map((s) => [s.path, s.name, s.isDir, s.commits])).toEqual([
      ["src/", "src/", true, 3],
      ["README.md", "README.md", false, 1],
    ]);
    // Only the loaded commits count: "gone" is not in the list.
    const src = hotspots(commits, files, "src/");
    expect(src.map((s) => [s.path, s.commits])).toEqual([
      ["src/a.ts", 3],
      ["src/b.ts", 1],
      ["src/lib/", 1],
    ]);
  });

  it("names the authors, co-authors included, and the newest change", () => {
    const [a] = hotspots(commits, files, "src/");
    expect(a?.authors).toEqual([
      { name: "Anna", commits: 3 },
      { name: "Bruno", commits: 1 },
    ]);
    expect(a?.last).toBe(300);
    expect(hotspots(commits, files, "").find((s) => s.path === "README.md")?.last).toBeNull();
  });

  it("keeps only the commits asked for", () => {
    const bruno = hotspots(commits, files, "", (c) => c.author === "Bruno");
    expect(bruno.map((s) => [s.path, s.commits])).toEqual([["src/", 1]]);
  });
});

it("builds the breadcrumb of a directory", () => {
  expect(dirTrail("")).toEqual([]);
  expect(dirTrail("src/lib/")).toEqual([
    { dir: "src/", name: "src" },
    { dir: "src/lib/", name: "lib" },
  ]);
});

it("searches the commits of a file or a directory", () => {
  expect(pathSearch({ path: "src/lib/" })).toBe("path:src/lib");
  expect(pathSearch({ path: "README.md" })).toBe("path:README.md");
});
