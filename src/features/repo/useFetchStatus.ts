import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type FetchState } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";
import { useRepoChanges } from "./useRepoChanges";

/**
 * How the background fetch of the remote branches is going, kept fresh by the backend's events,
 * and a way to fetch now. New remote commits reach the graph by themselves (the refs change).
 */
export function useFetchStatus(sessionId: string) {
  const queryClient = useQueryClient();
  const status = useQuery<FetchState, CommandError>({
    queryKey: ["fetch", sessionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await commands.fetchStatus(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
  useRepoChanges(
    sessionId,
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["fetch", sessionId] });
    }, [queryClient, sessionId]),
    "fetch-changed",
  );
  const fetchNow = useCallback(() => {
    void commands.fetchNow(sessionId);
  }, [sessionId]);
  return { state: status.data ?? null, fetchNow };
}

/** The current time, updated every `everyMs`: for "2 minutes ago" labels that keep up. */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
