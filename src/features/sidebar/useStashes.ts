import { useQuery } from "@tanstack/react-query";
import { commands, type StashEntry } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";

export function useStashes(sessionId: string) {
  return useQuery<StashEntry[], CommandError>({
    queryKey: ["stashes", sessionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await commands.listStashes(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}
