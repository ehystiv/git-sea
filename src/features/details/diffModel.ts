import type { DiffLine, Hunk } from "../../lib/bindings";

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
  /** Position of each side in the hunk's `lines`, to look up its tokens. */
  leftAt: number | null;
  rightAt: number | null;
}

/**
 * Lays a hunk out as two columns: context lines on both sides, and each run of deletions next
 * to the run of additions that follows it.
 */
export function splitRows(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.kind === "Context") {
      rows.push({ left: line, right: line, leftAt: i, rightAt: i });
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (lines[i]?.kind === "Del") dels.push(i++);
    while (lines[i]?.kind === "Add") adds.push(i++);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const l = dels[k];
      const r = adds[k];
      rows.push({
        left: l === undefined ? null : (lines[l] ?? null),
        right: r === undefined ? null : (lines[r] ?? null),
        leftAt: l ?? null,
        rightAt: r ?? null,
      });
    }
  }
  return rows;
}

export function hunkHeader(hunk: Hunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

export function totalLines(hunks: Hunk[]): number {
  return hunks.reduce((sum, h) => sum + h.lines.length, 0);
}

/** The first hunks whose lines add up to at most `limit` (always at least a cut of the first one). */
export function limitHunks(hunks: Hunk[], limit: number): Hunk[] {
  const out: Hunk[] = [];
  let used = 0;
  for (const hunk of hunks) {
    if (used >= limit) break;
    const room = limit - used;
    out.push(hunk.lines.length <= room ? hunk : { ...hunk, lines: hunk.lines.slice(0, room) });
    used += Math.min(room, hunk.lines.length);
  }
  return out;
}
