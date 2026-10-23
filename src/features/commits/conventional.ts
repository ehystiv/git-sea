import type { CommitSummary } from "../../lib/bindings";
import { leadingEmoji } from "../graph/emoji";

/** The parts of a Conventional Commits subject: `type(scope)!: description`. */
export interface Conventional {
  /** Lower case, as the filters compare it. */
  type: string;
  scope: string | null;
  /** Marked with `!`: a breaking change. */
  breaking: boolean;
  description: string;
}

const PATTERN = /^([A-Za-z]+)(?:\(([^)]*)\))?(!)?: (.*)$/;

/** The Conventional Commits parts of a subject (an emoji before them is allowed), or null. */
export function parseConventional(summary: string): Conventional | null {
  const text = leadingEmoji(summary)?.rest ?? summary;
  const match = PATTERN.exec(text);
  if (!match) return null;
  const scope = match[2]?.trim() ?? "";
  return { type: (match[1] ?? "").toLowerCase(), scope: scope === "" ? null : scope, breaking: match[3] === "!", description: match[4] ?? "" };
}

/** `feat(stats)!`: the prefix as written in the subject, normalised. */
export function prefixOf(parts: Conventional): string {
  return `${parts.type}${parts.scope ? `(${parts.scope})` : ""}${parts.breaking ? "!" : ""}`;
}

export interface TypeStats {
  /** Commits counted: merges are left out, as they repeat what they bring. */
  commits: number;
  /** Of those, the ones with a Conventional Commits subject. */
  conventional: number;
  breaking: number;
  /** Most first, then by name. */
  types: Array<{ type: string; commits: number }>;
  /** Most first, then by name; scopes differing only in case are one. */
  scopes: Array<{ scope: string; commits: number }>;
}

/** Counts the types and scopes of the commits for which `include` holds. */
export function typeStats(commits: readonly CommitSummary[], include: (commit: CommitSummary) => boolean = () => true): TypeStats {
  const types = new Map<string, number>();
  const scopes = new Map<string, { scope: string; commits: number }>();
  let count = 0;
  let conventional = 0;
  let breaking = 0;
  for (const commit of commits) {
    if (commit.parents.length > 1 || !include(commit)) continue;
    count++;
    const parts = parseConventional(commit.summary);
    if (!parts) continue;
    conventional++;
    if (parts.breaking) breaking++;
    types.set(parts.type, (types.get(parts.type) ?? 0) + 1);
    if (parts.scope) {
      const key = parts.scope.toLowerCase();
      const entry = scopes.get(key) ?? { scope: parts.scope, commits: 0 };
      entry.commits++;
      scopes.set(key, entry);
    }
  }
  const byCount = <T extends { commits: number }>(name: (x: T) => string) => (a: T, b: T) => b.commits - a.commits || name(a).localeCompare(name(b));
  return {
    commits: count,
    conventional,
    breaking,
    types: [...types].map(([type, n]) => ({ type, commits: n })).sort(byCount((x) => x.type)),
    scopes: [...scopes.values()].sort(byCount((x) => x.scope)),
  };
}

/** Whether a commit has one of `types` (lower case), or one of `scopes` (any case). */
export function hasType(commit: CommitSummary, types: readonly string[]): boolean {
  const parts = parseConventional(commit.summary);
  return parts !== null && types.includes(parts.type);
}

export function hasScope(commit: CommitSummary, scopes: readonly string[]): boolean {
  const scope = parseConventional(commit.summary)?.scope?.toLowerCase();
  return scope !== undefined && scopes.includes(scope);
}
