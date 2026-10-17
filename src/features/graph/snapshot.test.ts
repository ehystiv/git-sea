import { describe, expect, it } from "vitest";
import { MAX_SNAPSHOT_SIDE, blobToBase64, snapshotScale } from "./snapshot";

describe("snapshotScale", () => {
  it("draws at twice the size at least, or at the screen's density when higher", () => {
    expect(snapshotScale(1200, 800, 1)).toBe(2);
    expect(snapshotScale(1200, 800, 3)).toBe(3);
  });

  it("keeps the longest side within the limit", () => {
    const scale = snapshotScale(6000, 1000, 2);
    expect(6000 * scale).toBeLessThanOrEqual(MAX_SNAPSHOT_SIDE);
  });
});

describe("blobToBase64", () => {
  it("encodes the bytes", async () => {
    expect(await blobToBase64(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]))).toBe("iVBORw==");
    // Larger than one chunk, to cover the joining.
    const big = new Uint8Array(70_000).fill(65);
    expect(atob(await blobToBase64(new Blob([big])))).toHaveLength(70_000);
  });
});
