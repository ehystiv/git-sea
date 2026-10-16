import { describe, expect, it } from "vitest";
import { describeFilter, inFilter, pruneFilter, sameRef, toggleRef } from "./refFilter";

describe("sameRef", () => {
  it("treats a local branch the same with or without HEAD on it", () => {
    expect(sameRef({ kind: "Head", name: "main" }, { kind: "Branch", name: "main" })).toBe(true);
    expect(sameRef({ kind: "Branch", name: "main" }, { kind: "Remote", name: "main" })).toBe(false);
    expect(sameRef({ kind: "Head", name: "HEAD" }, { kind: "Branch", name: "HEAD" })).toBe(false);
    expect(sameRef({ kind: "Tag", name: "v1" }, { kind: "Tag", name: "v2" })).toBe(false);
  });
});

describe("toggleRef", () => {
  it("adds, removes, and gives null when the filter empties", () => {
    const one = toggleRef(null, { kind: "Branch", name: "main" });
    expect(one).toEqual([{ kind: "Branch", name: "main" }]);
    const two = toggleRef(one, { kind: "Remote", name: "origin/dev" });
    expect(two).toHaveLength(2);
    expect(inFilter(two, { kind: "Head", name: "main" })).toBe(true);
    expect(toggleRef(two, { kind: "Head", name: "main" })).toEqual([{ kind: "Remote", name: "origin/dev" }]);
    expect(toggleRef(one, { kind: "Branch", name: "main" })).toBeNull();
  });
});

describe("pruneFilter", () => {
  const filter = [
    { kind: "Branch" as const, name: "main" },
    { kind: "Branch" as const, name: "gone" },
  ];

  it("drops refs that no longer exist and keeps the same array when all do", () => {
    expect(pruneFilter(filter, [{ kind: "Head", name: "main" }])).toEqual([{ kind: "Branch", name: "main" }]);
    const all = [
      { kind: "Branch" as const, name: "main" },
      { kind: "Branch" as const, name: "gone" },
    ];
    expect(pruneFilter(filter, all)).toBe(filter);
    expect(pruneFilter(filter, [])).toBeNull();
    expect(pruneFilter(null, all)).toBeNull();
  });
});

describe("describeFilter", () => {
  it("names one or two refs and counts the rest", () => {
    expect(describeFilter([{ kind: "Branch", name: "main" }])).toBe("main");
    expect(
      describeFilter([
        { kind: "Branch", name: "main" },
        { kind: "Tag", name: "v1" },
      ]),
    ).toBe("main, v1");
    expect(
      describeFilter([
        { kind: "Branch", name: "main" },
        { kind: "Tag", name: "v1" },
        { kind: "Tag", name: "v2" },
      ]),
    ).toBe("main e altri 2");
  });
});
