import { useQuery } from "@tanstack/react-query";
import { commands, type FileContent, type TreeFile } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

// A commit's tree never changes: what the backend says about it stays valid for the session.
const IMMUTABLE = { staleTime: Infinity, gcTime: 10 * 60_000, retry: false } as const;

/** Every file of the commit's tree, sorted by path. */
export function useTreeFiles(sessionId: string, commitId: string | null) {
  return useQuery<TreeFile[], CommandError>({
    queryKey: ["tree-files", sessionId, commitId],
    enabled: commitId !== null,
    ...IMMUTABLE,
    // Stepping through commits keeps the previous tree on screen until the next one arrives.
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await commands.listFiles(sessionId, commitId ?? "");
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

/** The content of `path` as it is in the commit. */
export function useFileContent(sessionId: string, commitId: string | null, path: string | null) {
  return useQuery<FileContent, CommandError>({
    queryKey: ["file-content", sessionId, commitId, path],
    enabled: commitId !== null && path !== null,
    ...IMMUTABLE,
    queryFn: async () => {
      const result = await commands.fileContent(sessionId, commitId ?? "", path ?? "");
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
