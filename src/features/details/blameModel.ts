import type { BlameCommit, FileBlame } from "../../lib/bindings";

/** One line of the blame view. */
export interface BlameRow {
  /** 0-based line index in the file. */
  line: number;
  /** First line of its run: the gutter names the commit only there. */
  first: boolean;
  /** Position of the run in the file, to alternate the background of neighbouring runs. */
  run: number;
  commit: BlameCommit | null;
  /** The path the line had in that commit, when the file was renamed since. */
  sourcePath: string | null;
  /** 0 for the oldest commit of the file, 1 for the newest, ranked by author time. */
  age: number;
}

/** A row for every line of the blamed file, in file order. */
export function blameRows(blame: FileBlame): BlameRow[] {
  const byId = new Map(blame.commits.map((c) => [c.id, c]));
  const times = [...new Set(blame.commits.map((c) => c.time ?? 0))].sort((a, b) => a - b);
  const rank = new Map(times.map((time, i) => [time, times.length > 1 ? i / (times.length - 1) : 1]));

  const rows: BlameRow[] = [];
  blame.hunks.forEach((hunk, run) => {
    const commit = byId.get(hunk.commit) ?? null;
    for (let i = 0; i < hunk.len; i++) {
      rows.push({
        line: hunk.start + i,
        first: i === 0,
        run,
        commit,
        sourcePath: hunk.sourcePath,
        age: commit ? (rank.get(commit.time ?? 0) ?? 1) : 1,
      });
    }
  });
  return rows;
}
