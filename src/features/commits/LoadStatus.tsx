import type { CommitSummary, FetchState } from "../../lib/bindings";
import { formatAgo, shortHash } from "../../lib/format";
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

  return (
    <footer className={styles.status}>
      <span className={styles.count}>{index.length.toLocaleString("it-IT")} commit</span>
      {status === "loading" && <span>Caricamento…</span>}
      {refreshing && <span>Aggiornamento…</span>}
      {maxLanes !== null && <span>{maxLanes} corsie</span>}
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
  if (fetch.running) return <span>Aggiorno dal remoto…</span>;
  const failed = fetch.lastError !== null;
  const label = failed
    ? "Aggiornamento dal remoto non riuscito"
    : fetch.lastSuccessMs === null
      ? "Remoto non ancora aggiornato"
      : `Remoto aggiornato ${formatAgo(fetch.lastSuccessMs / 1000, now)}`;
  return (
    <span>
      <button
        type="button"
        className={`${styles.fetch} ${failed ? styles.error : ""}`}
        title={failed ? `${fetch.lastError ?? ""}\nClic per riprovare` : "Clic per aggiornare ora"}
        onClick={onFetchNow}
      >
        {label}
      </button>
    </span>
  );
}
