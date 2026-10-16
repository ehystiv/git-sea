import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { commands } from "../../lib/bindings";
import { CommandError, describeError } from "../../lib/errors";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { GraphIndex } from "../graph/GraphIndex";
import { inWalkOrder, matchCommits, needsBackend, parseQuery, type SearchQuery } from "./query";

export interface SearchState {
  query: SearchQuery | null;
  /** Ids of the matching commits that are loaded, newest first; null while there is no answer yet. */
  ids: string[] | null;
  /** The backend is still looking. */
  pending: boolean;
  /** The backend stopped at its limit: there are more matches than `ids`. */
  truncated: boolean;
  error: string | null;
}

/** Thrown for a search the backend dropped for a newer one, so its partial answer is not kept. */
class Superseded extends Error {}

const BACKEND_DELAY_MS = 300;
const LOCAL_DELAY_MS = 80;

/** Runs the search typed in `raw` over the history in `index`: in place, or in the backend. */
export function useSearch(sessionId: string, index: GraphIndex, version: number, raw: string): SearchState {
  const parsed = useMemo(() => parseQuery(raw), [raw]);
  const backend = parsed !== null && needsBackend(parsed);
  // Typing a path should not start a walk of the whole history at every key.
  const debounced = useDebouncedValue(parsed, backend ? BACKEND_DELAY_MS : LOCAL_DELAY_MS);
  const query = debounced !== null && parsed !== null && debounced.mode === parsed.mode && debounced.text === parsed.text ? debounced : null;
  const remote = query !== null && needsBackend(query) ? query : null;

  const result = useQuery({
    queryKey: ["search", sessionId, remote?.mode, remote?.text],
    enabled: remote !== null,
    staleTime: Infinity,
    retry: (count, error) => error instanceof Superseded && count < 1,
    queryFn: async () => {
      if (!remote) return null;
      const response = await commands.searchCommits(sessionId, remote.mode === "path" ? "Path" : "Message", remote.text);
      if (response.status === "error") throw new CommandError(response.error);
      if (response.data.cancelled) throw new Superseded();
      return response.data;
    },
  });

  // `version` is what tells us the (mutable) index changed.
  const local = useMemo(
    () => (query !== null && !needsBackend(query) ? matchCommits(index.commits, query) : null),
    [query, index, version],
  );
  const fromBackend = result.data;
  const remoteIds = useMemo(
    () => (fromBackend ? inWalkOrder(fromBackend.ids, (id) => index.indexOf(id)) : null),
    [fromBackend, index, version],
  );

  if (parsed === null) return { query: null, ids: null, pending: false, truncated: false, error: null };
  if (query === null) return { query: parsed, ids: null, pending: true, truncated: false, error: null };
  if (remote === null) return { query, ids: local, pending: false, truncated: false, error: null };
  const failed = result.error && !(result.error instanceof Superseded) ? describeError(result.error) : null;
  return {
    query,
    ids: remoteIds,
    pending: result.isFetching,
    truncated: fromBackend?.truncated ?? false,
    error: failed,
  };
}
