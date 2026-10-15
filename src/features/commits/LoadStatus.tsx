import type { CommitSummary } from "../../lib/bindings";
import { shortHash } from "../../lib/format";
import type { CommitStream } from "./useCommitStream";
import styles from "./LoadStatus.module.css";

/** Status bar of the commit list; the timings make load speed easy to check. */
export function LoadStatus({
  stream,
  selected,
}: {
  stream: CommitStream;
  selected: CommitSummary | null;
}) {
  const { index, status, firstChunkMs, doneMs, backend, maxLanes, fromCache, refreshing, error } = stream;
  const backendHint = backend
    ? `Backend: preparazione ${backend.setupMs} ms, primo blocco ${backend.firstChunkMs} ms, totale ${backend.totalMs} ms`
    : undefined;

  return (
    <footer className={styles.status} title={backendHint}>
      <span className={styles.count}>{index.length.toLocaleString("it-IT")} commit</span>
      {status === "loading" && <span>Caricamento…</span>}
      {refreshing && <span>Aggiornamento…</span>}
      {firstChunkMs !== null && <span>primo blocco {firstChunkMs} ms</span>}
      {doneMs !== null && (
        <span>
          completato in {doneMs} ms{fromCache ? " (cache)" : ""}
        </span>
      )}
      {maxLanes !== null && <span>{maxLanes} corsie</span>}
      {selected && (
        <span className={styles.selected}>
          {shortHash(selected.id)} {selected.summary}
        </span>
      )}
      {status === "error" && <span className={styles.error}>{error}</span>}
    </footer>
  );
}
