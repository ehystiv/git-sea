import { useQuery } from "@tanstack/react-query";
import { commands, type RepoWeb } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

/** Where the repository's commits can be seen on the web; null for a local or unknown remote. */
export function useRepoWeb(sessionId: string) {
  return useQuery<RepoWeb | null, CommandError>({
    queryKey: ["repo-web", sessionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await commands.repoWeb(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
