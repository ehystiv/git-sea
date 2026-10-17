import { describe, expect, it } from "vitest";
import { menuPosition } from "./position";

describe("menuPosition", () => {
  it("opens below and right of the pointer when there is room", () => {
    expect(menuPosition(100, 50, 200, 150, 1000, 800)).toEqual({ left: 100, top: 50 });
  });

  it("flips to the left and above near the right and bottom edges", () => {
    expect(menuPosition(950, 750, 200, 150, 1000, 800)).toEqual({ left: 750, top: 600 });
  });

  it("opens above when asked, unless there is no room there", () => {
    expect(menuPosition(100, 700, 200, 150, 1000, 800, "above")).toEqual({ left: 100, top: 550 });
    expect(menuPosition(100, 60, 200, 150, 1000, 800, "above")).toEqual({ left: 100, top: 60 });
  });

  it("stays inside a window smaller than the menu would need", () => {
    expect(menuPosition(100, 100, 200, 500, 300, 400)).toEqual({ left: 8, top: 8 });
  });
});
