import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { commands, type SearchField } from "../../lib/bindings";
import { CommandError, describeError } from "../../lib/errors";
import { useT, type Messages } from "../../lib/i18n";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { GraphIndex } from "../graph/GraphIndex";
import { commitMatcher, inWalkOrder, matchCommits, parseQuery, type BackendTerm, type QueryError, type SearchQuery } from "./query";

export interface SearchState {
  query: SearchQuery | null;
  /** Ids of the matching commits that are loaded, newest first; null while there is no answer yet. */
  ids: string[] | null;
  /** The backend is still looking. */
  pending: boolean;
  /** The backend stopped at its limit: there are more matches than `ids`. */
  truncated: boolean;
  /** The backend failed; the details are in the message. */
  error: string | null;
  /** The query cannot be read (a bad date or expression), said in words. */
  invalid: string | null;
}

/** Thrown for a search the backend dropped for a newer one, so its partial answer is not kept. */
class Superseded extends Error {}

const BACKEND_DELAY_MS = 300;
const LOCAL_DELAY_MS = 80;
const FIELD: Record<BackendTerm["kind"], SearchField> = { message: "Message", path: "Path", diff: "Diff" };

function describeQueryError(error: QueryError, m: Messages): string {
  switch (error.kind) {
    case "date":
      return m.search.badDate(error.value);
    case "regex":
      return m.search.badRegex;
    case "twoBackend":
      return m.search.twoBackend;
  }
}

/**
 * Runs the search typed in `raw` over the history in `index`. Terms the frontend can check run in
 * place; a `msg:`, `path:` or `diff:` term runs in the backend, and the other terms then filter
 * what it found.
 */
export function useSearch(sessionId: string, index: GraphIndex, version: number, raw: string): SearchState {
  const m = useT();
  const parsed = useMemo(() => parseQuery(raw), [raw]);
  const valid = parsed !== null && !("error" in parsed) ? parsed : null;
  const backend = valid?.backend != null;
  // Typing a path should not start a walk of the whole history at every key.
  const debounced = useDebouncedValue(valid, backend ? BACKEND_DELAY_MS : LOCAL_DELAY_MS);
  const query = debounced !== null && valid !== null && debounced.key === valid.key ? debounced : null;
  const remote = query?.backend ?? null;

  const result = useQuery({
    queryKey: ["search", sessionId, remote?.kind, remote?.text],
    enabled: remote !== null,
    staleTime: Infinity,
    retry: (count, error) => error instanceof Superseded && count < 1,
    queryFn: async () => {
      if (!remote) return null;
      const response = await commands.searchCommits(sessionId, FIELD[remote.kind], remote.text);
      if (response.status === "error") throw new CommandError(response.error);
      if (response.data.cancelled) throw new Superseded();
      return response.data;
    },
  });

  // `version` is what tells us the (mutable) index changed.
  const local = useMemo(
    () => (query !== null && query.backend === null ? matchCommits(index.commits, query) : null),
    [query, index, version],
  );
  const fromBackend = result.data;
  const remoteIds = useMemo(() => {
    if (!fromBackend || !query) return null;
    const test = commitMatcher(query);
    const ids = inWalkOrder(fromBackend.ids, (id) => index.indexOf(id));
    return query.local.length === 0 ? ids : ids.filter((id) => {
      const commit = index.commits[index.indexOf(id) ?? -1];
      return commit !== undefined && test(commit);
    });
  }, [fromBackend, query, index, version]);

  const none: SearchState = { query: null, ids: null, pending: false, truncated: false, error: null, invalid: null };
  if (parsed === null) return none;
  if ("error" in parsed) return { ...none, invalid: describeQueryError(parsed.error, m) };
  if (query === null) return { ...none, query: parsed, pending: true };
  if (remote === null) return { ...none, query, ids: local };
  const failed = result.error && !(result.error instanceof Superseded) ? describeError(result.error) : null;
  return {
    query,
    ids: remoteIds,
    pending: result.isFetching,
    truncated: fromBackend?.truncated ?? false,
    error: failed,
    invalid: null,
  };
}
