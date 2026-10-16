import { leadingEmoji } from "./emoji";

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
  /** Emoji the message starts with (gitmoji style), shown in the node instead of the kind icon. */
  emoji?: string;
}

const KNOWN: ReadonlySet<string> = new Set(["feat", "fix", "refactor", "docs", "chore", "perf"]);
/** Other Conventional Commits types, shown with the maintenance icon. */
const MAINTENANCE: ReadonlySet<string> = new Set(["build", "ci", "style", "test", "revert"]);
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?: (.*)$/;

/**
 * Classifies a commit by its Conventional Commits prefix, merge-ness and root-ness, and picks up
 * an emoji at the start of the message or right after the prefix ("✨ feat: …", "feat: ✨ …",
 * ":sparkles: …"). The emoji is taken out of the label, since the node shows it.
 */
export function describeCommit(summary: string, parentCount: number): Described {
  const before = parentCount > 1 ? null : leadingEmoji(summary);
  const described = classify(before ? before.rest : summary, parentCount);
  if (before) return { ...described, emoji: before.emoji };
  if (described.kind === "merge") return described;
  const after = leadingEmoji(described.label);
  return after ? { ...described, label: after.rest, emoji: after.emoji } : described;
}

function classify(summary: string, parentCount: number): Described {
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
