import { describe, expect, it } from "vitest";
import type { RepoInfo } from "../lib/bindings";
import {
  MAX_RECENTS,
  activate,
  activateAt,
  addTab,
  closeTab,
  emptyTabs,
  findTabByPath,
  normalizePath,
  removeRecent,
} from "./tabsLogic";

function repo(n: number, path = `/repos/r${n}`): RepoInfo {
  return {
    sessionId: `s${n}`,
    name: `r${n}`,
    path,
    head: { kind: "Unborn", name: "main" },
    refCount: 0,
    isBare: false,
  };
}

const open = (...repos: RepoInfo[]) => repos.reduce(addTab, emptyTabs);

describe("addTab", () => {
  it("activates the new tab and gives each tab the next colour", () => {
    const data = open(repo(1), repo(2), repo(3));
    expect(data.tabs.map((t) => t.id)).toEqual(["s1", "s2", "s3"]);
    expect(data.activeId).toBe("s3");
    expect(data.tabs.map((t) => t.color)).toEqual([0, 1, 2]);
  });

  it("wraps colours around the palette", () => {
    const data = open(...Array.from({ length: 10 }, (_, i) => repo(i)));
    expect(data.tabs[8]?.color).toBe(0);
    expect(data.tabs[9]?.color).toBe(1);
  });

  it("keeps the most recently opened repository first in the recents, without duplicates", () => {
    const data = open(repo(1), repo(2), repo(3, "/repos/r1/"));
    expect(data.recents.map((r) => r.path)).toEqual(["/repos/r1", "/repos/r2"]);
  });

  it("remembers at most MAX_RECENTS repositories", () => {
    const data = open(...Array.from({ length: MAX_RECENTS + 3 }, (_, i) => repo(i)));
    expect(data.recents).toHaveLength(MAX_RECENTS);
    expect(data.recents[0]?.path).toBe(`/repos/r${MAX_RECENTS + 2}`);
  });
});

describe("closeTab", () => {
  it("moves to the tab on the left when the active one closes", () => {
    const data = closeTab(open(repo(1), repo(2), repo(3)), "s3");
    expect(data.activeId).toBe("s2");
  });

  it("moves to the tab that took its place when the first tab closes", () => {
    const data = closeTab(activate(open(repo(1), repo(2)), "s1"), "s1");
    expect(data.activeId).toBe("s2");
  });

  it("keeps the active tab when another one closes", () => {
    const data = closeTab(open(repo(1), repo(2), repo(3)), "s1");
    expect(data.activeId).toBe("s3");
    expect(data.tabs.map((t) => t.id)).toEqual(["s2", "s3"]);
  });

  it("leaves nothing active when the last tab closes and ignores unknown ids", () => {
    expect(closeTab(open(repo(1)), "s1").activeId).toBeNull();
    const data = open(repo(1));
    expect(closeTab(data, "nope")).toBe(data);
  });

  it("does not forget the recents", () => {
    expect(closeTab(open(repo(1)), "s1").recents).toHaveLength(1);
  });
});

describe("switching", () => {
  it("activates by id and ignores unknown ids", () => {
    const data = open(repo(1), repo(2));
    expect(activate(data, "s1").activeId).toBe("s1");
    expect(activate(data, "x")).toBe(data);
  });

  it("activates by position, with the last tab for ⌘9", () => {
    const data = open(repo(1), repo(2), repo(3));
    expect(activateAt(data, 0).activeId).toBe("s1");
    expect(activateAt(data, 8, true).activeId).toBe("s3");
    expect(activateAt(data, 7)).toBe(data);
  });
});

describe("paths", () => {
  it("ignores trailing slashes when looking for an open repository", () => {
    const data = open(repo(1));
    expect(findTabByPath(data, "/repos/r1/")?.id).toBe("s1");
    expect(findTabByPath(data, "/repos/other")).toBeUndefined();
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath(" /a/b// ")).toBe("/a/b");
    expect(normalizePath("C:\\repos\\r1\\")).toBe("C:\\repos\\r1");
    expect(normalizePath("C:\\")).toBe("C:\\");
  });

  it("removes a repository from the recents", () => {
    const data = removeRecent(open(repo(1), repo(2)), "/repos/r1");
    expect(data.recents.map((r) => r.path)).toEqual(["/repos/r2"]);
  });
});
