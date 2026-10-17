import { describe, expect, it } from "vitest";
import { formatAgo, formatRelative } from "../format";
import { en } from "./en";
import { it as itMessages } from "./it";

/** Every key of `a`, as dotted paths, with "fn" or "text" for what the value is. */
function shape(a: object, prefix = ""): string[] {
  return Object.entries(a).flatMap(([key, value]) =>
    typeof value === "object" && value !== null ? shape(value, `${prefix}${key}.`) : [`${prefix}${key}:${typeof value === "function" ? "fn" : "text"}`],
  );
}

describe("messages", () => {
  it("has the same texts in Italian as in English", () => {
    expect(shape(itMessages).sort()).toEqual(shape(en).sort());
  });

  it("leaves no text empty except where meant", () => {
    const empty = shape(en).filter((key) => key.endsWith(":text")).filter((key) => {
      const value = key.slice(0, -":text".length).split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en);
      return value === "";
    });
    expect(empty).toEqual(["ci.tokenHint.Jenkins:text"]);
  });
});

describe("relative times", () => {
  const now = Date.UTC(2026, 9, 17);
  const ago = (seconds: number) => now / 1000 - seconds;

  it("writes compact ages in each language", () => {
    expect(formatRelative(ago(3 * 86_400), now, en)).toBe("3d");
    expect(formatRelative(ago(3 * 86_400), now, itMessages)).toBe("3g");
    expect(formatRelative(ago(14 * 86_400), now, en)).toBe("2w");
    expect(formatRelative(ago(14 * 86_400), now, itMessages)).toBe("2sett");
  });

  it("says now for the last minute", () => {
    expect(formatAgo(ago(10), now, en)).toBe("now");
    expect(formatAgo(ago(10), now, itMessages)).toBe("adesso");
  });
});
