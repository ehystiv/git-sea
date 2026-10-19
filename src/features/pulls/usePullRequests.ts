import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type PullRequestsReport } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";
import { useRepoChanges } from "../repo/useRepoChanges";

/** How often the requests are asked again while the tab is in front. */
const INTERVAL_MS = 3 * 60_000;

/** The recently updated pull or merge requests of the main remote's project. */
export function usePullRequests(sessionId: string, active: boolean) {
  const queryClient = useQueryClient();
  const query = useQuery<PullRequestsReport, CommandError>({
    queryKey: ["pulls", sessionId],
    staleTime: 60_000,
    retry: false,
    refetchInterval: active ? INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const result = await commands.pullRequests(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
  // A fetch brings the branches of new requests; asking again puts them on the graph.
  useRepoChanges(
    sessionId,
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["pulls", sessionId] });
    }, [queryClient, sessionId]),
    "fetch-changed",
  );
  return query;
}
