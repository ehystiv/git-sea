import { describe, expect, it } from "vitest";
import type { DiffLine, Hunk } from "../../lib/bindings";
import { highlightHunks, languageFor } from "./highlight";
import { limitHunks, splitRows, totalLines } from "./diffModel";

const line = (kind: DiffLine["kind"], text: string): DiffLine => ({ kind, text, oldNo: null, newNo: null });
const hunk = (...lines: DiffLine[]): Hunk => ({ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines });

describe("splitRows", () => {
  it("shows context on both sides", () => {
    const rows = splitRows(hunk(line("Context", "a")));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.left).toBe(rows[0]?.right);
  });

  it("pairs a run of deletions with the run of additions after it", () => {
    const rows = splitRows(
      hunk(line("Del", "old1"), line("Del", "old2"), line("Add", "new1"), line("Add", "new2"), line("Add", "new3")),
    );
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ["old1", "new1"],
      ["old2", "new2"],
      [null, "new3"],
    ]);
    expect(rows.map((r) => [r.leftAt, r.rightAt])).toEqual([
      [0, 2],
      [1, 3],
      [null, 4],
    ]);
  });

  it("handles a pure deletion and a pure addition", () => {
    expect(splitRows(hunk(line("Del", "gone"))).map((r) => r.right)).toEqual([null]);
    expect(splitRows(hunk(line("Add", "new"))).map((r) => r.left)).toEqual([null]);
  });
});

describe("limitHunks", () => {
  const big = hunk(...Array.from({ length: 10 }, (_, i) => line("Context", `l${i}`)));

  it("keeps everything under the limit", () => {
    expect(limitHunks([big, big], 100)).toEqual([big, big]);
  });

  it("cuts inside a hunk when the limit falls there", () => {
    const cut = limitHunks([big, big], 14);
    expect(totalLines(cut)).toBe(14);
    expect(cut).toHaveLength(2);
  });
});

describe("highlighting", () => {
  it("picks the language from the file extension", () => {
    expect(languageFor("src/app/main.ts")).toBe("typescript");
    expect(languageFor("Cargo.toml")).toBe("toml");
    expect(languageFor("Makefile")).toBeNull();
    expect(languageFor("archive.xyz")).toBeNull();
  });

  it("tokenises both sides of a hunk and keeps the text intact", async () => {
    const h = hunk(
      line("Context", "const a = 1;"),
      line("Del", "const b = 2;"),
      line("Add", "const b = 3;"),
    );

    const tokens = await highlightHunks("x.ts", [h]);

    expect(tokens).not.toBeNull();
    const lines = tokens?.[0] ?? [];
    expect(lines).toHaveLength(3);
    const text = (i: number) => lines[i]?.map((t) => t.content).join("");
    expect(text(0)).toBe("const a = 1;");
    expect(text(1)).toBe("const b = 2;");
    expect(text(2)).toBe("const b = 3;");
    expect(lines[0]?.[0]?.color).toContain("--shiki-token-keyword");
  });

  it("returns null for languages it does not know", async () => {
    expect(await highlightHunks("notes.xyz", [hunk(line("Add", "text"))])).toBeNull();
  });
});
