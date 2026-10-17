import type { CommitSummary, FetchState } from "../../lib/bindings";
import { formatAgo, formatCount, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useNow } from "../repo/useFetchStatus";
import type { CommitStream } from "./useCommitStream";
import styles from "./LoadStatus.module.css";

/** Status bar of the commit list. */
export function LoadStatus({
  stream,
  selected,
  fetch,
  onFetchNow,
}: {
  stream: CommitStream;
  selected: CommitSummary | null;
  /** The background fetch of the remote branches; null while unknown. */
  fetch: FetchState | null;
  onFetchNow: () => void;
}) {
  const { index, status, maxLanes, refreshing, error } = stream;
  const m = useT();

  return (
    <footer className={styles.status}>
      <span className={styles.count}>{m.status.commits(formatCount(index.length))}</span>
      {status === "loading" && <span>{m.status.loading}</span>}
      {refreshing && <span>{m.status.refreshing}</span>}
      {maxLanes !== null && <span>{m.status.branches(maxLanes)}</span>}
      {fetch?.hasRemotes && <FetchInfo fetch={fetch} onFetchNow={onFetchNow} />}
      {selected && (
        <span className={styles.selected}>
          {shortHash(selected.id)} {selected.summary}
        </span>
      )}
      {status === "error" && <span className={styles.error}>{error}</span>}
    </footer>
  );
}

/** The last fetch of the remote branches; a click fetches again. */
function FetchInfo({ fetch, onFetchNow }: { fetch: FetchState; onFetchNow: () => void }) {
  const now = useNow(30_000);
  const m = useT();
  if (fetch.running) return <span>{m.status.fetching}</span>;
  const failed = fetch.lastError !== null;
  const label = failed
    ? m.status.fetchFailed
    : fetch.lastSuccessMs === null
      ? m.status.notFetched
      : m.status.fetched(formatAgo(fetch.lastSuccessMs / 1000, now, m));
  return (
    <span>
      <button
        type="button"
        className={`${styles.fetch} ${failed ? styles.error : ""}`}
        title={failed ? m.status.retry(fetch.lastError ?? "") : m.status.fetchNow}
        onClick={onFetchNow}
      >
        {label}
      </button>
    </span>
  );
}
