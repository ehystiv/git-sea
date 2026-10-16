import { describe, expect, it } from "vitest";
import { nextMode, parseMode, resolveTheme } from "./themeLogic";

describe("theme", () => {
  it("follows the system only in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("cycles through every mode and comes back", () => {
    expect(nextMode("system")).toBe("light");
    expect(nextMode("light")).toBe("dark");
    expect(nextMode("dark")).toBe("system");
  });

  it("ignores unknown stored values", () => {
    expect(parseMode("dark")).toBe("dark");
    expect(parseMode("sepia")).toBe("system");
    expect(parseMode(undefined)).toBe("system");
  });
});
