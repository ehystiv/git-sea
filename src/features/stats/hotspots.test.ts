import { describe, expect, it } from "vitest";
import type { CommitSummary, FileActivity } from "../../lib/bindings";
import { parseQuery } from "../search/query";
import { dirTrail, fileHeatmap, filesByCommit, hotspots, linesByCommit, monthSearch, pathSearch } from "./hotspots";

const commit = (id: string, author: string, time: number | null, coAuthors?: string[]): CommitSummary => ({ id, summary: id, author, time, parents: [], coAuthors });

const activity: FileActivity = {
  paths: ["src/a.ts", "src/b.ts", "src/lib/c.ts", "README.md"],
  commits: [
    { id: "c3", files: [0, 1], added: null, removed: null },
    { id: "c2", files: [0, 2], added: null, removed: null },
    { id: "c1", files: [3, 0], added: null, removed: null },
    { id: "gone", files: [3], added: null, removed: null },
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

  it("sums the lines when they were counted, and can rank by them", () => {
    expect(linesByCommit(activity)).toBeNull();
    const counted: FileActivity = {
      ...activity,
      commits: activity.commits.map((c) => ({ ...c, added: c.files.map(() => 1), removed: c.files.map((f) => (f === 2 ? 50 : 0)) })),
    };
    const lines = linesByCommit(counted);
    const byCommits = hotspots(commits, files, "src/", undefined, lines);
    expect(byCommits.map((s) => [s.path, s.added, s.removed])).toEqual([
      ["src/a.ts", 3, 0],
      ["src/b.ts", 1, 0],
      ["src/lib/", 1, 50],
    ]);
    expect(hotspots(commits, files, "src/", undefined, lines, "lines")[0]?.path).toBe("src/lib/");
    // A directory sums every file a commit changed in it.
    expect(hotspots(commits, files, "", undefined, lines).find((s) => s.path === "src/")).toMatchObject({ commits: 3, added: 5, removed: 50 });
  });

  it("keeps only the commits asked for", () => {
    const bruno = hotspots(commits, files, "", (c) => c.author === "Bruno");
    expect(bruno.map((s) => [s.path, s.commits])).toEqual([["src/", 1]]);
  });
});

describe("fileHeatmap", () => {
  const at = (year: number, month: number, day = 15) => new Date(year, month - 1, day).getTime() / 1000;
  const dated = [commit("c3", "Anna", at(2026, 3)), commit("c2", "Bruno", at(2026, 1, 2)), commit("c1", "Anna", at(2025, 12, 31)), commit("x", "Anna", null)];
  const files = filesByCommit({ ...activity, commits: [...activity.commits, { id: "x", files: [0], added: null, removed: null }] });

  it("counts the changes of the top entries month by month", () => {
    const map = fileHeatmap(dated, files, "src/", 2);
    expect(map.months.map((m) => m.key)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(map.rows.map((r) => [r.spot.path, r.counts])).toEqual([
      ["src/a.ts", [1, 1, 0, 1]],
      ["src/b.ts", [0, 0, 0, 1]],
    ]);
    expect(map.max).toBe(1);
    expect(map.months[0]?.start).toBe(new Date(2025, 11, 1).getTime() / 1000);
  });

  it("is empty when nothing dated changed", () => {
    expect(fileHeatmap(dated, files, "docs/", 5)).toEqual({ months: [], rows: [], max: 0 });
  });

  it("searches the commits of one month", () => {
    const text = monthSearch({ path: "src/" }, { key: "2025-12", start: 0, end: new Date(2026, 0, 1).getTime() / 1000 });
    expect(text).toBe("path:src after:2025-12 before:2026-01");
    expect(parseQuery(text)).not.toBeNull();
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
