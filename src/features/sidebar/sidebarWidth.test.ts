import { describe, expect, it } from "vitest";
import { SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth } from "./sidebarWidth";

describe("clampSidebarWidth", () => {
  it("keeps the width between the limits, in whole pixels", () => {
    expect(clampSidebarWidth(300.4)).toBe(300);
    expect(clampSidebarWidth(20)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX);
  });
});
