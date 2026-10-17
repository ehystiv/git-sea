import { describe, expect, it } from "vitest";
import type { RefLabel, StashEntry } from "../../lib/bindings";
import { bookmarkSection, buildSections } from "./sections";

const ref = (name: string, kind: RefLabel["kind"], commit = "c"): RefLabel => ({ name, kind, commit });
const labels = (...list: RefLabel[]): RefLabel[][] => list.map((l) => [l]);

describe("buildSections", () => {
  it("groups refs by kind and puts the current branch first", () => {
    const sections = buildSections(
      labels(
        ref("zeta", "Branch"),
        ref("alpha", "Branch"),
        ref("main", "Head"),
        ref("origin/main", "Remote"),
        ref("v1.0", "Tag"),
      ),
      [],
      "",
    );

    expect(sections.map((s) => s.id)).toEqual(["branches", "remotes", "tags"]);
    expect(sections[0]?.items.map((i) => i.label)).toEqual(["main", "alpha", "zeta"]);
    expect(sections[0]?.items[0]?.isHead).toBe(true);
  });

  it("sorts tags newest version first, comparing numbers as numbers", () => {
    const sections = buildSections(labels(ref("v2", "Tag"), ref("v10", "Tag"), ref("v9", "Tag")), [], "");
    expect(sections[0]?.items.map((i) => i.label)).toEqual(["v10", "v9", "v2"]);
  });

  it("lists stashes by their base commit", () => {
    const stash: StashEntry = { index: 0, message: "WIP on main", commit: "s", base: "b" };
    const [section] = buildSections([], [stash], "");
    expect(section?.id).toBe("stashes");
    expect(section?.items[0]).toMatchObject({ label: "WIP on main", commit: "b" });
  });

  it("filters by name ignoring case and drops groups that end up empty", () => {
    const sections = buildSections(
      labels(ref("feat/Login", "Branch"), ref("fix/header", "Branch"), ref("v1", "Tag")),
      [],
      "LOGIN",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items.map((i) => i.label)).toEqual(["feat/Login"]);
  });

  it("shows nothing for a repository without refs", () => {
    expect(buildSections([], [], "")).toEqual([]);
  });
});

describe("bookmarkSection", () => {
  it("lists the bookmarks in their order, with the hash for commits not loaded", () => {
    const section = bookmarkSection(
      [
        { id: "aaaaaaa111", summary: "fix: login" },
        { id: "bbbbbbb222", summary: null },
      ],
      "",
    );
    expect(section?.items.map((i) => [i.label, i.commit, i.bookmark])).toEqual([
      ["fix: login", "aaaaaaa111", true],
      ["bbbbbbb", "bbbbbbb222", true],
    ]);
  });

  it("is filtered like the refs and missing when empty", () => {
    expect(bookmarkSection([{ id: "a", summary: "fix: login" }], "LOG")?.items).toHaveLength(1);
    expect(bookmarkSection([{ id: "a", summary: "fix: login" }], "zzz")).toBeNull();
    expect(bookmarkSection([], "")).toBeNull();
  });
});
