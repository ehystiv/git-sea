import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type CiOverview, type CiProvider, type CiRunsReport } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";
import { useRepoChanges } from "../repo/useRepoChanges";

/** How often the runs are asked again while the tab is in front. */
const RUNS_INTERVAL_MS = 90_000;

/**
 * The repository's workflows (from HEAD) and the runs the CI services report for them. The
 * workflows are read again when the refs change, the runs every 90 seconds while `active` and
 * after each background fetch.
 */
export function useCi(sessionId: string, active: boolean) {
  const queryClient = useQueryClient();

  const overview = useQuery<CiOverview, CommandError>({
    queryKey: ["ci", sessionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await commands.ciOverview(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });

  const hasWorkflows = (overview.data?.workflows.length ?? 0) > 0;
  const runs = useQuery<CiRunsReport, CommandError>({
    queryKey: ["ci-runs", sessionId],
    enabled: hasWorkflows,
    staleTime: 30_000,
    retry: false,
    refetchInterval: active ? RUNS_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const result = await commands.ciRuns(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });

  const refreshRuns = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ci-runs", sessionId] });
  }, [queryClient, sessionId]);

  // A checkout, a commit or a fetch can change the workflows in HEAD and the refs they run on.
  useRepoChanges(
    sessionId,
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["ci", sessionId] });
    }, [queryClient, sessionId]),
  );
  // After a fetch, others' pushes may have started runs.
  useRepoChanges(sessionId, refreshRuns, "fetch-changed");

  const setToken = useCallback(
    async (provider: CiProvider, token: string | null) => {
      const result = await commands.ciSetToken(provider, token);
      if (result.status === "error") throw new CommandError(result.error);
      refreshRuns();
    },
    [refreshRuns],
  );

  return {
    overview: overview.data ?? null,
    overviewError: overview.error,
    report: runs.data ?? null,
    runsLoading: runs.isFetching,
    refreshRuns,
    setToken,
  };
}

export type CiState = ReturnType<typeof useCi>;

/** Opens a CI page in the browser. */
export function openUrl(url: string): void {
  void commands.openUrl(url);
}
