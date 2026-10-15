import { useQuery } from "@tanstack/react-query";
import { commands, type CommitDetails, type FileChange, type FileDiff } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

// Commits never change, so what the backend says about one stays valid for the whole session.
const IMMUTABLE = { staleTime: Infinity, gcTime: 10 * 60_000, retry: false } as const;

export function useCommitDetails(sessionId: string, commitId: string | null) {
  return useQuery<CommitDetails, CommandError>({
    queryKey: ["commit-details", sessionId, commitId],
    enabled: commitId !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.commitDetails(sessionId, commitId ?? "");
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

export function useFileDiff(sessionId: string, commitId: string | null, file: FileChange | null) {
  return useQuery<FileDiff, CommandError>({
    queryKey: ["file-diff", sessionId, commitId, file?.path, file?.oldPath],
    enabled: commitId !== null && file !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.fileDiff(sessionId, commitId ?? "", file?.path ?? "", file?.oldPath ?? null);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
