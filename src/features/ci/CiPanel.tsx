import type { CiRun, CommitSummary } from "../../lib/bindings";
import { formatAgo, shortHash } from "../../lib/format";
import { PROVIDER_LABEL, STATUS_LABEL, statusColor } from "./labels";
import type { CiMarker } from "./markers";
import { openUrl, type CiState } from "./useCi";
import details from "../details/DetailsPanel.module.css";
import styles from "./CiPanel.module.css";

interface CiPanelProps {
  commit: CommitSummary | null;
  /** What the graph shows for this commit, without the workflow focus. */
  marker: CiMarker | null;
  ci: CiState;
  onShowCommit: () => void;
}

/** CI of one commit: its runs, and what a push or a merge here would start. */
export function CiPanel({ commit, marker, ci, onShowCommit }: CiPanelProps) {
  const workflows = ci.overview?.workflows ?? [];
  const name = (id: number) => workflows[id]?.name ?? "?";
  const runs = marker?.runs ?? [];

  return (
    <aside className={details.panel} aria-label="CI del commit">
      <header className={details.head}>
        <div className={details.kind}>CI</div>
        <h2 className={details.title}>{commit?.summary || "Commit"}</h2>
        {commit && (
          <dl className={details.grid}>
            <dt>Commit</dt>
            <dd>
              <button type="button" className={details.chip} onClick={onShowCommit}>
                <code>{shortHash(commit.id)}</code>
                <span>Dettagli e diff</span>
              </button>
            </dd>
          </dl>
        )}
      </header>

      <section className={details.section}>
        <h3>
          Run
          <span className={details.count}>{runs.length}</span>
          <button type="button" className={`${details.link} ${styles.refresh}`} onClick={ci.refreshRuns} disabled={ci.runsLoading}>
            {ci.runsLoading ? "Aggiorno…" : "Aggiorna"}
          </button>
        </h3>
        {runs.length === 0 ? (
          <p className={details.hint}>Nessuna run nota su questo commit.</p>
        ) : (
          <ul className={styles.runs}>
            {runs.map((run, i) => (
              <RunRow key={`${run.provider}:${run.workflow}:${i}`} run={run} />
            ))}
          </ul>
        )}
      </section>

      {marker && (marker.push.length > 0 || marker.merge.length > 0) && (
        <section className={details.section}>
          <h3>Lanci ipotetici</h3>
          <p className={details.hint}>Dedotti dalle regole dei workflow in HEAD, senza contattare i servizi.</p>
          <ul className={styles.hypotheses}>
            {marker.push.length > 0 && (
              <li>
                <span className={styles.ring} />
                <span>
                  Un push di <b>{marker.pushRefs.join(", ")}</b> avvierebbe {marker.push.map(name).join(", ")}
                </span>
              </li>
            )}
            {marker.merge.length > 0 && (
              <li>
                <span className={styles.ring} />
                <span>
                  Un merge in <b>{marker.target}</b> (pull request) avvierebbe {marker.merge.map(name).join(", ")}
                </span>
              </li>
            )}
          </ul>
          {[...marker.push, ...marker.merge].some((id) => workflows[id]?.approximate) && (
            <p className={details.hint}>Alcuni di questi workflow hanno condizioni su file o variabili che non vengono valutate.</p>
          )}
        </section>
      )}
    </aside>
  );
}

function RunRow({ run }: { run: CiRun }) {
  const created = run.created ? Date.parse(run.created) : NaN;
  const meta = [PROVIDER_LABEL[run.provider], run.branch, run.event, Number.isNaN(created) ? null : formatAgo(created / 1000)].filter(Boolean).join(" · ");
  return (
    <li className={styles.run}>
      <span className={styles.status} style={{ background: statusColor(run.status) }} title={STATUS_LABEL[run.status]} />
      <span className={styles.text}>
        <span className={styles.name}>
          {run.workflow} <span className={styles.outcome}>{STATUS_LABEL[run.status]}</span>
        </span>
        <span className={styles.meta}>{meta}</span>
      </span>
      {run.url && (
        <button type="button" className={details.link} onClick={() => run.url && openUrl(run.url)}>
          Apri ↗
        </button>
      )}
    </li>
  );
}
