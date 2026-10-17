import { describe, expect, it } from "vitest";
import { hasModKey, modShortcut } from "./platform";

const keys = (metaKey: boolean, ctrlKey: boolean) => ({ metaKey, ctrlKey });

describe("hasModKey", () => {
  it("uses ⌘ on macOS", () => {
    expect(hasModKey(keys(true, false), true)).toBe(true);
    expect(hasModKey(keys(false, true), true)).toBe(false);
    expect(hasModKey(keys(true, true), true)).toBe(false);
  });

  it("uses Ctrl elsewhere", () => {
    expect(hasModKey(keys(false, true), false)).toBe(true);
    expect(hasModKey(keys(true, false), false)).toBe(false);
    expect(hasModKey(keys(true, true), false)).toBe(false);
  });
});

describe("modShortcut", () => {
  it("writes shortcuts the platform's way", () => {
    expect(modShortcut("K", true)).toBe("⌘K");
    expect(modShortcut("K", false)).toBe("Ctrl+K");
  });
});
