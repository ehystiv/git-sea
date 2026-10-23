import type { CleanupRef, CleanupReport } from "../../lib/bindings";

export type CleanupGroup = "goneRemote" | "goneUpstream" | "merged" | "noUpstream";

/** The groups of the report that have something, in the order the sidebar shows them. */
export function cleanupGroups(report: CleanupReport): Array<{ group: CleanupGroup; refs: CleanupRef[] }> {
  const groups: Array<{ group: CleanupGroup; refs: CleanupRef[] }> = [
    { group: "goneRemote", refs: report.goneRemote },
    { group: "goneUpstream", refs: report.goneUpstream },
    { group: "merged", refs: report.merged },
    { group: "noUpstream", refs: report.noUpstream },
  ];
  return groups.filter((g) => g.refs.length > 0);
}

/** Quotes a branch name for a POSIX shell when it needs it. */
function shellWord(name: string): string {
  return /^[\w./@+-]+$/.test(name) ? name : `'${name.replace(/'/g, `'\\''`)}'`;
}

/**
 * The git command that would clean a group up, for the user to run (the app never does): a prune
 * per remote for gone remote branches, `git branch -d` for local ones (which refuses to drop
 * unmerged work). Null for branches without an upstream, which are only listed.
 */
export function cleanupCommand(group: CleanupGroup, refs: readonly CleanupRef[]): string | null {
  switch (group) {
    case "goneRemote": {
      const remotes = [...new Set(refs.map((r) => r.name.split("/")[0] ?? ""))].filter(Boolean);
      return remotes.map((remote) => `git remote prune ${shellWord(remote)}`).join("\n");
    }
    case "goneUpstream":
    case "merged":
      return `git branch -d ${refs.map((r) => shellWord(r.name)).join(" ")}`;
    case "noUpstream":
      return null;
  }
}
