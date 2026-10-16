import { describe, expect, it } from "vitest";
import type { CommitSummary } from "../../lib/bindings";
import { inWalkOrder, matchCommits, needsBackend, parseQuery, stepMatch } from "./query";

const commit = (id: string, summary: string, author: string): CommitSummary => ({ id, summary, author, time: 0, parents: [] });
const commits = [
  commit("a1b2c3d4e5", "Fix the parser", "Anna Rossi"),
  commit("ffee001122", "Add search", "Marco Bianchi"),
  commit("0badcafe00", "fix: typo in README", "anna"),
];

describe("parseQuery", () => {
  it("reads the prefixes, in English and Italian", () => {
    expect(parseQuery("author: Anna ")).toEqual({ mode: "author", text: "Anna" });
    expect(parseQuery("autore:anna")).toEqual({ mode: "author", text: "anna" });
    expect(parseQuery("PATH:src/lib")).toEqual({ mode: "path", text: "src/lib" });
    expect(parseQuery("file: README.md")).toEqual({ mode: "path", text: "README.md" });
    expect(parseQuery("msg:refactor")).toEqual({ mode: "message", text: "refactor" });
    expect(parseQuery("hash:abc1")).toEqual({ mode: "hash", text: "abc1" });
  });

  it("treats an unknown prefix as plain text, and nothing as no query", () => {
    expect(parseQuery("fix: typo")).toEqual({ mode: "text", text: "fix: typo" });
    expect(parseQuery("  ")).toBeNull();
    expect(parseQuery("path:  ")).toBeNull();
  });

  it("knows which searches need the backend", () => {
    expect(needsBackend({ mode: "path", text: "a" })).toBe(true);
    expect(needsBackend({ mode: "message", text: "a" })).toBe(true);
    expect(needsBackend({ mode: "text", text: "a" })).toBe(false);
  });
});

describe("matchCommits", () => {
  it("matches subject and author case-insensitively, in walk order", () => {
    expect(matchCommits(commits, { mode: "text", text: "fix" })).toEqual(["a1b2c3d4e5", "0badcafe00"]);
    expect(matchCommits(commits, { mode: "text", text: "ANNA" })).toEqual(["a1b2c3d4e5", "0badcafe00"]);
  });

  it("matches the start of the hash from four hex digits", () => {
    expect(matchCommits(commits, { mode: "text", text: "ffee" })).toEqual(["ffee001122"]);
    expect(matchCommits(commits, { mode: "text", text: "ffe" })).toEqual([]);
    expect(matchCommits(commits, { mode: "hash", text: "0bad" })).toEqual(["0badcafe00"]);
  });

  it("restricts to the author with the prefix, and stops at the limit", () => {
    expect(matchCommits(commits, { mode: "author", text: "marco" })).toEqual(["ffee001122"]);
    expect(matchCommits(commits, { mode: "author", text: "fix" })).toEqual([]);
    expect(matchCommits(commits, { mode: "text", text: "a" }, 2)).toHaveLength(2);
  });
});

describe("inWalkOrder", () => {
  it("sorts by position and drops unknown ids", () => {
    const position = (id: string) => ({ x: 2, y: 0, z: 1 })[id] ?? null;
    expect(inWalkOrder(["x", "nope", "y", "z"], position)).toEqual(["y", "z", "x"]);
  });
});

describe("stepMatch", () => {
  it("wraps around in both directions", () => {
    expect(stepMatch(3, null, 1)).toBe(0);
    expect(stepMatch(3, null, -1)).toBe(2);
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
    expect(stepMatch(0, null, 1)).toBeNull();
  });
});
