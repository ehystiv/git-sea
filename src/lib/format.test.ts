import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("picks the unit that fits", () => {
    // The tests run with the default locale, English.
    expect(formatBytes(512)).toBe("512 byte");
    expect(formatBytes(740_000)).toBe("740 kB");
    expect(formatBytes(17_400_000)).toBe("17.4 MB");
    expect(formatBytes(3_200_000_000)).toBe("3.2 GB");
    expect(formatBytes(-1)).toBe("0 byte");
  });
});
