import { queryOptions, useQuery } from "@tanstack/react-query";
import { commands, type CommitDetails, type FileBlame, type FileChange, type FileDiff } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

// Commits never change, so what the backend says about one stays valid for the whole session.
const IMMUTABLE = { staleTime: Infinity, gcTime: 10 * 60_000, retry: false } as const;

/** The query behind `useCommitDetails`, also for reading a commit outside a component. */
export function commitDetailsQuery(sessionId: string, commitId: string | null, base: string | null = null) {
  return queryOptions<CommitDetails, CommandError>({
    queryKey: ["commit-details", sessionId, commitId, base],
    enabled: commitId !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.commitDetails(sessionId, commitId ?? "", base);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

/** The commit and its changed files, against its first parent or against `base` when given. */
export function useCommitDetails(sessionId: string, commitId: string | null, base: string | null = null) {
  return useQuery(commitDetailsQuery(sessionId, commitId, base));
}

export function useFileDiff(sessionId: string, commitId: string | null, file: FileChange | null, base: string | null = null) {
  return useQuery<FileDiff, CommandError>({
    queryKey: ["file-diff", sessionId, commitId, file?.path, file?.oldPath, base],
    enabled: commitId !== null && file !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.fileDiff(sessionId, commitId ?? "", file?.path ?? "", file?.oldPath ?? null, base);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

/** For every line of `path` as it is in the commit, the commit that last changed it. */
export function useBlame(sessionId: string, commitId: string | null, path: string | null) {
  return useQuery<FileBlame, CommandError>({
    queryKey: ["blame", sessionId, commitId, path],
    enabled: commitId !== null && path !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.blameFile(sessionId, commitId ?? "", path ?? "");
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
