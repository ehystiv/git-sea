import { describe, expect, it } from "vitest";
import type { CommitSummary } from "../../lib/bindings";
import { inWalkOrder, matchCommits, parseQuery, stepMatch, textQuery, type SearchQuery } from "./query";

const commit = (id: string, summary: string, author: string, time: number | null = 0): CommitSummary => ({ id, summary, author, time, parents: [] });
const commits = [
  commit("a1b2c3d4e5", "Fix the parser", "Anna Rossi"),
  commit("ffee001122", "Add search", "Marco Bianchi"),
  commit("0badcafe00", "fix: typo in README", "anna"),
];

const NOW = new Date(2026, 9, 17, 15, 30).getTime();
const parse = (raw: string) => parseQuery(raw, NOW);
const terms = (raw: string) => {
  const q = parse(raw);
  return q && !("error" in q) ? { local: q.local, backend: q.backend } : q;
};

describe("parseQuery", () => {
  it("reads the prefixes, in English and Italian", () => {
    expect(terms("author: Anna ")).toEqual({ local: [{ kind: "author", text: "Anna" }], backend: null });
    expect(terms("autore:anna")).toEqual({ local: [{ kind: "author", text: "anna" }], backend: null });
    expect(terms("PATH:src/lib")).toEqual({ local: [], backend: { kind: "path", text: "src/lib" } });
    expect(terms("file: README.md")).toEqual({ local: [], backend: { kind: "path", text: "README.md" } });
    expect(terms("msg:refactor the parser")).toEqual({ local: [], backend: { kind: "message", text: "refactor the parser" } });
    expect(terms("diff:useMemo(")).toEqual({ local: [], backend: { kind: "diff", text: "useMemo(" } });
    expect(terms("hash:abc1")).toEqual({ local: [{ kind: "hash", text: "abc1" }], backend: null });
  });

  it("treats an unknown prefix as plain text, and nothing as no query", () => {
    expect(terms("fix: typo")).toEqual({ local: [{ kind: "text", text: "fix: typo" }], backend: null });
    expect(parse("  ")).toBeNull();
    expect(parse("path:  ")).toBeNull();
  });

  it("combines words and terms, each running to the next prefix", () => {
    expect(terms("login author:Anna Rossi path:src/auth")).toEqual({
      local: [
        { kind: "text", text: "login" },
        { kind: "author", text: "Anna Rossi" },
      ],
      backend: { kind: "path", text: "src/auth" },
    });
    expect(terms('path:"my dir/a b.txt"')).toEqual({ local: [], backend: { kind: "path", text: "my dir/a b.txt" } });
  });

  it("reads absolute and relative dates", () => {
    const at = (raw: string) => {
      const q = parse(raw);
      const term = q && !("error" in q) ? q.local[0] : undefined;
      return term && "time" in term ? term.time : null;
    };
    expect(at("after:2024")).toBe(new Date(2024, 0, 1).getTime() / 1000);
    expect(at("dopo:2024-05")).toBe(new Date(2024, 4, 1).getTime() / 1000);
    expect(at("before:2024-05-17")).toBe(new Date(2024, 4, 17).getTime() / 1000);
    expect(at("since:today")).toBe(new Date(2026, 9, 17).getTime() / 1000);
    expect(at("prima:ieri")).toBe(new Date(2026, 9, 16).getTime() / 1000);
    expect(at("after:2w")).toBe(Math.floor(NOW / 1000) - 14 * 86_400);
    expect(at("dopo:3g")).toBe(Math.floor(NOW / 1000) - 3 * 86_400);
  });

  it("reports what it cannot read", () => {
    expect(parse("after:soon")).toEqual({ error: { kind: "date", value: "soon" } });
    expect(parse("after:2024-13")).toEqual({ error: { kind: "date", value: "2024-13" } });
    expect(parse("re:([a-z")).toEqual({ error: { kind: "regex", value: "([a-z" } });
    expect(parse("msg:a path:b")).toEqual({ error: { kind: "twoBackend" } });
  });

  it("gives equal queries the same key", () => {
    const a = parse("author:anna  path:src");
    const b = parse("author: anna path: src ");
    expect(a && !("error" in a) && a.key).toBe(b && !("error" in b) && b.key);
  });
});

const q = (raw: string): SearchQuery => {
  const parsed = parseQuery(raw, NOW);
  if (!parsed || "error" in parsed) throw new Error(raw);
  return parsed;
};

describe("matchCommits", () => {
  it("needs every term to hold", () => {
    expect(matchCommits(commits, q("fix author:anna"))).toEqual(["a1b2c3d4e5", "0badcafe00"]);
    expect(matchCommits(commits, q("fix author:rossi"))).toEqual(["a1b2c3d4e5"]);
  });

  it("filters by date, with the end of the range left out", () => {
    const dated = [commit("a", "x", "A", 100), commit("b", "x", "A", 200), commit("c", "x", "A", null)];
    const range = (after: number, before: number): SearchQuery => ({ local: [{ kind: "after", time: after }, { kind: "before", time: before }], backend: null, key: "" });
    expect(matchCommits(dated, range(100, 200))).toEqual(["a"]);
    expect(matchCommits(dated, range(0, 1000))).toEqual(["a", "b"]);
  });

  it("matches a regular expression on subject and author", () => {
    expect(matchCommits(commits, q("re:^fix\\b"))).toEqual(["a1b2c3d4e5", "0badcafe00"]);
    expect(matchCommits(commits, q("re:bianchi$"))).toEqual(["ffee001122"]);
  });

  it("matches subject and author case-insensitively, in walk order", () => {
    expect(matchCommits(commits, textQuery("fix"))).toEqual(["a1b2c3d4e5", "0badcafe00"]);
    expect(matchCommits(commits, textQuery("ANNA"))).toEqual(["a1b2c3d4e5", "0badcafe00"]);
  });

  it("matches the start of the hash from four hex digits", () => {
    expect(matchCommits(commits, textQuery("ffee"))).toEqual(["ffee001122"]);
    expect(matchCommits(commits, textQuery("ffe"))).toEqual([]);
    expect(matchCommits(commits, q("hash:0bad"))).toEqual(["0badcafe00"]);
  });

  it("counts co-authors as authors", () => {
    const shared = [{ ...commit("c0ffee0000", "pair work", "Bruno"), coAuthors: ["Anna Rossi"] }, commit("deadbeef00", "solo", "Bruno")];
    expect(matchCommits(shared, q("author:anna"))).toEqual(["c0ffee0000"]);
    expect(matchCommits(shared, textQuery("rossi"))).toEqual(["c0ffee0000"]);
    expect(matchCommits(shared, q("re:^anna"))).toEqual(["c0ffee0000"]);
  });

  it("restricts to the author with the prefix, and stops at the limit", () => {
    expect(matchCommits(commits, q("author:marco"))).toEqual(["ffee001122"]);
    expect(matchCommits(commits, q("author:fix"))).toEqual([]);
    expect(matchCommits(commits, textQuery("a"), 2)).toHaveLength(2);
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
