import { describe, expect, it } from "vitest";
import { downloadFraction, onDownloadEvent, startDownload, type DownloadEvent } from "./progress";

const run = (events: DownloadEvent[]) => events.reduce(onDownloadEvent, startDownload);

describe("download progress", () => {
  it("adds up the chunks against the announced size", () => {
    const d = run([
      { event: "Started", data: { contentLength: 1000 } },
      { event: "Progress", data: { chunkLength: 250 } },
      { event: "Progress", data: { chunkLength: 250 } },
    ]);
    expect(d).toEqual({ downloaded: 500, total: 1000 });
    expect(downloadFraction(d)).toBe(0.5);
    expect(downloadFraction(onDownloadEvent(d, { event: "Finished" }))).toBe(1);
  });

  it("has no fraction while the size is unknown, and never goes past the end", () => {
    const unknown = run([{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 10 } }]);
    expect(downloadFraction(unknown)).toBeNull();
    expect(downloadFraction({ downloaded: 30, total: 20 })).toBe(1);
  });
});
