import { describe, expect, it } from "vitest";
import { MAX_BOOKMARKS, bookmarksOf, toggleBookmark } from "./bookmarks";

describe("toggleBookmark", () => {
  it("adds to the front and removes on a second toggle", () => {
    let all = toggleBookmark({}, "/r", "a");
    all = toggleBookmark(all, "/r", "b");
    expect(bookmarksOf(all, "/r")).toEqual(["b", "a"]);
    all = toggleBookmark(all, "/r", "a");
    expect(bookmarksOf(all, "/r")).toEqual(["b"]);
  });

  it("keeps repositories apart and drops a repository left without bookmarks", () => {
    let all = toggleBookmark(toggleBookmark({}, "/r", "a"), "/s", "a");
    expect(bookmarksOf(all, "/s")).toEqual(["a"]);
    all = toggleBookmark(all, "/r", "a");
    expect(Object.keys(all)).toEqual(["/s"]);
  });

  it("keeps at most MAX_BOOKMARKS per repository", () => {
    let all = {};
    for (let i = 0; i <= MAX_BOOKMARKS; i++) all = toggleBookmark(all, "/r", `c${i}`);
    expect(bookmarksOf(all, "/r")).toHaveLength(MAX_BOOKMARKS);
    expect(bookmarksOf(all, "/r")[0]).toBe(`c${MAX_BOOKMARKS}`);
  });
});
