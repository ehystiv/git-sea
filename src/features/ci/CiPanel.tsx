import type { CiRun, CommitSummary } from "../../lib/bindings";
import { formatAgo, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { PROVIDER_LABEL, statusColor, statusLabel } from "./labels";
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
  const m = useT();
  const workflows = ci.overview?.workflows ?? [];
  const name = (id: number) => workflows[id]?.name ?? "?";
  const runs = marker?.runs ?? [];

  return (
    <aside className={details.panel} aria-label={m.ci.panel.label}>
      <header className={details.head}>
        <div className={details.kind}>CI</div>
        <h2 className={details.title}>{commit?.summary || m.details.commit}</h2>
        {commit && (
          <dl className={details.grid}>
            <dt>{m.details.commit}</dt>
            <dd>
              <button type="button" className={details.chip} onClick={onShowCommit}>
                <code>{shortHash(commit.id)}</code>
                <span>{m.ci.panel.detailsAndDiff}</span>
              </button>
            </dd>
          </dl>
        )}
      </header>

      <section className={details.section}>
        <h3>
          {m.ci.panel.runs}
          <span className={details.count}>{runs.length}</span>
          <button type="button" className={`${details.link} ${styles.refresh}`} onClick={ci.refreshRuns} disabled={ci.runsLoading}>
            {ci.runsLoading ? m.ci.panel.refreshing : m.ci.panel.refresh}
          </button>
        </h3>
        {runs.length === 0 ? (
          <p className={details.hint}>{m.ci.panel.noRuns}</p>
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
          <h3>{m.ci.panel.hypothetical}</h3>
          <p className={details.hint}>{m.ci.panel.hypotheticalHint}</p>
          <ul className={styles.hypotheses}>
            {marker.push.length > 0 && (
              <li>
                <span className={styles.ring} />
                <span>
                  {m.ci.panel.pushOf} <b>{marker.pushRefs.join(", ")}</b> {m.ci.panel.wouldStart} {marker.push.map(name).join(", ")}
                </span>
              </li>
            )}
            {marker.merge.length > 0 && (
              <li>
                <span className={styles.ring} />
                <span>
                  {m.ci.panel.mergeInto} <b>{marker.target}</b> {m.ci.panel.pullRequest} {m.ci.panel.wouldStart} {marker.merge.map(name).join(", ")}
                </span>
              </li>
            )}
          </ul>
          {[...marker.push, ...marker.merge].some((id) => workflows[id]?.approximate) && (
            <p className={details.hint}>{m.ci.panel.approximate}</p>
          )}
        </section>
      )}
    </aside>
  );
}

function RunRow({ run }: { run: CiRun }) {
  const m = useT();
  const created = run.created ? Date.parse(run.created) : NaN;
  const meta = [PROVIDER_LABEL[run.provider], run.branch, run.event, Number.isNaN(created) ? null : formatAgo(created / 1000)].filter(Boolean).join(" · ");
  return (
    <li className={styles.run}>
      <span className={styles.status} style={{ background: statusColor(run.status) }} title={statusLabel(run.status, m)} />
      <span className={styles.text}>
        <span className={styles.name}>
          {run.workflow} <span className={styles.outcome}>{statusLabel(run.status, m)}</span>
        </span>
        <span className={styles.meta}>{meta}</span>
      </span>
      {run.url && (
        <button type="button" className={details.link} onClick={() => run.url && openUrl(run.url)}>
          {m.ci.panel.open}
        </button>
      )}
    </li>
  );
}
