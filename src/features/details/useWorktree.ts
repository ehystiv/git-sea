import { useQuery } from "@tanstack/react-query";
import { commands, type FileChange, type FileDiff, type WorktreeStatus } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

// The working copy changes under our feet; these stay valid until the backend reports a change,
// which invalidates them (see RepoView).
const UNTIL_CHANGED = { staleTime: Infinity, retry: false } as const;

export function useWorktreeStatus(sessionId: string, enabled = true) {
  return useQuery<WorktreeStatus, CommandError>({
    queryKey: ["worktree", sessionId],
    enabled,
    ...UNTIL_CHANGED,
    queryFn: async () => {
      const result = await commands.worktreeStatus(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

/** Diff of a locally changed file: HEAD → index when `staged`, else index → disk. */
export function useWorktreeDiff(sessionId: string, file: FileChange | null, staged: boolean) {
  return useQuery<FileDiff, CommandError>({
    queryKey: ["worktree", sessionId, "diff", file?.path, file?.oldPath, staged],
    enabled: file !== null,
    ...UNTIL_CHANGED,
    queryFn: async () => {
      const result = await commands.worktreeDiff(sessionId, file?.path ?? "", file?.oldPath ?? null, staged);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
