export type CommitKind =
  | "merge"
  | "feat"
  | "fix"
  | "refactor"
  | "docs"
  | "chore"
  | "perf"
  | "init"
  | "commit";

export interface Described {
  kind: CommitKind;
  /** Short text shown under the node. */
  label: string;
}

const KNOWN: ReadonlySet<string> = new Set(["feat", "fix", "refactor", "docs", "chore", "perf"]);
/** Other Conventional Commits types, shown with the maintenance icon. */
const MAINTENANCE: ReadonlySet<string> = new Set(["build", "ci", "style", "test", "revert"]);
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?: (.*)$/;

/** Classifies a commit by its Conventional Commits prefix, merge-ness and root-ness. */
export function describeCommit(summary: string, parentCount: number): Described {
  if (parentCount > 1) {
    return { kind: "merge", label: summary.replace(/^Merge (branches|branch|pull request|tag) /, "").replace(/'/g, "") };
  }
  if (parentCount === 0) return { kind: "init", label: summary };
  const match = CONVENTIONAL.exec(summary);
  if (!match) return { kind: "commit", label: summary };
  const [, type = "", description] = match;
  if (KNOWN.has(type)) return { kind: type as CommitKind, label: description ?? summary };
  return { kind: MAINTENANCE.has(type) ? "chore" : "commit", label: description ?? summary };
}
