import { useMemo, useState } from "react";
import { dateFormatter, formatAgo, formatCount } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { GraphIndex } from "../graph/GraphIndex";
import { releaseStats } from "./releases";
import styles from "./StatsView.module.css";

/** Releases listed before "Show all". */
const TOP = 12;
const dayDate = dateFormatter({ dateStyle: "medium" });

interface ReleasesCardProps {
  index: GraphIndex;
  version: number;
  /** Shows what `target` brings since `base` (a release and the one before it). */
  onCompare: (base: string, target: string) => void;
  onShowCommit: (id: string) => void;
}

/** The tags as releases: how many, how often, how big, and what HEAD has not released yet. */
export function ReleasesCard({ index, version, onCompare, onShowCommit }: ReleasesCardProps) {
  const m = useT();
  const [all, setAll] = useState(false);
  // `version` stands for the contents of `index`, which is mutated in place.
  const stats = useMemo(() => releaseStats(index), [index, version]);
  if (stats.releases.length === 0) return null;

  const latest = stats.releases[0];
  const shown = all ? stats.releases : stats.releases.slice(0, TOP);
  const top = Math.max(1, ...stats.releases.map((r) => r.commits));
  const days = (n: number) => formatCount(Math.round(n));

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{m.stats.releases}</h2>
        <span className={styles.note}>{m.stats.releasesNote}</span>
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{m.stats.releaseCount}</span>
          <span className={styles.tileValue}>{formatCount(stats.releases.length)}</span>
          <span className={styles.note}>{m.stats.inLastYear(stats.lastYear)}</span>
        </div>
        {latest && (
          <div className={styles.tile}>
            <span className={styles.tileLabel}>{m.stats.latest}</span>
            <span className={`${styles.tileValue} ${styles.tileSmall}`}>{latest.name}</span>
            {latest.time !== null && <span className={styles.note}>{formatAgo(latest.time, Date.now(), m)}</span>}
          </div>
        )}
        {stats.medianDays !== null && (
          <div className={styles.tile}>
            <span className={styles.tileLabel}>{m.stats.every}</span>
            <span className={`${styles.tileValue} ${styles.tileSmall}`}>{m.stats.everyDays(days(stats.medianDays))}</span>
            <span className={styles.note}>{m.stats.median}</span>
          </div>
        )}
        <button
          type="button"
          className={`${styles.tile} ${styles.tileButton}`}
          disabled={stats.pending === 0 || !latest || stats.head === null}
          title={stats.pending > 0 ? m.stats.showPending : undefined}
          onClick={() => latest && stats.head && onCompare(latest.commit, stats.head)}
        >
          <span className={styles.tileLabel}>{m.stats.pending}</span>
          <span className={styles.tileValue}>{stats.pending > 0 ? formatCount(stats.pending) : "0"}</span>
          <span className={styles.note}>{stats.pending > 0 && stats.pendingSince !== null ? m.stats.pendingNote(dayDate().format(new Date(stats.pendingSince * 1000))) : m.stats.nothingPending}</span>
        </button>
      </div>

      <ol className={`${styles.authors} ${styles.releaseList}`}>
        {shown.map((release) => (
          <li key={release.commit} className={styles.author}>
            <button
              type="button"
              className={`${styles.authorMain} ${styles.releaseMain}`}
              title={release.previous ? m.stats.showRelease(release.name) : release.name}
              onClick={() => (release.previous ? onCompare(release.previous.commit, release.commit) : onShowCommit(release.commit))}
            >
              <span className={styles.name}>
                {release.name}
                {release.aliases.length > 0 && <span className={styles.alias}> {release.aliases.join(", ")}</span>}
              </span>
              <span className={styles.seen}>{release.time === null ? m.stats.noDate : dayDate().format(new Date(release.time * 1000))}</span>
              <span className={styles.bar}>
                <span style={{ width: `${(release.commits / top) * 100}%` }} />
              </span>
              <span className={styles.count}>{m.stats.releaseRow(release.commits)}</span>
              <span className={styles.seen}>
                {m.stats.authorsCount(release.authors)}
                {release.days !== null && ` · ${m.stats.afterDays(days(release.days))}`}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {stats.releases.length > TOP && (
        <button type="button" className={styles.more} onClick={() => setAll((on) => !on)}>
          {all ? m.stats.showFewer : m.stats.showAllReleases(formatCount(stats.releases.length))}
        </button>
      )}
    </section>
  );
}
