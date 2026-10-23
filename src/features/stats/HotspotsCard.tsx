import { useMemo, useState } from "react";
import { formatAgo, formatCount } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { authorsOf } from "../commits/authors";
import type { GraphIndex } from "../graph/GraphIndex";
import { dirTrail, filesByCommit, hotspots, pathSearch, type Hotspot } from "./hotspots";
import { calendarPeriod } from "./stats";
import type { FileActivityState } from "./useFileActivity";
import styles from "./StatsView.module.css";

/** Rows listed before "Show all". */
const TOP = 20;

interface HotspotsCardProps {
  index: GraphIndex;
  version: number;
  activity: FileActivityState;
  /** Only this author's commits count, when set. */
  author: string | null;
  onSearch: (text: string) => void;
}

/** The files and directories changed most often, one directory at a time. */
export function HotspotsCard({ index, version, activity, author, onSearch }: HotspotsCardProps) {
  const m = useT();
  const [dir, setDir] = useState("");
  const [period, setPeriod] = useState<"all" | "last">("all");
  const [all, setAll] = useState(false);

  const files = useMemo(() => (activity.activity ? filesByCommit(activity.activity) : null), [activity.activity]);
  const spots = useMemo(() => {
    if (!files) return [];
    const since = period === "last" ? calendarPeriod("last", new Date()).start.getTime() / 1000 : null;
    return hotspots(index.commits, files, dir, (c) => (author === null || authorsOf(c).includes(author)) && (since === null || (c.time !== null && c.time >= since)));
    // `version` stands for the contents of `index`, which is mutated in place.
  }, [files, index, version, dir, period, author]);

  const shown = all ? spots : spots.slice(0, TOP);
  const top = spots[0]?.commits ?? 1;
  const now = Date.now();
  const open = (spot: Hotspot) => {
    setDir(spot.path);
    setAll(false);
  };

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{m.stats.hotspots}</h2>
        <span className={styles.note}>{m.stats.hotspotsNote}</span>
        <select className={styles.select} aria-label={m.stats.year} value={period} onChange={(e) => setPeriod(e.target.value === "last" ? "last" : "all")}>
          <option value="all">{m.stats.allTime}</option>
          <option value="last">{m.stats.lastYear}</option>
        </select>
      </div>

      <nav className={styles.trail} aria-label={m.stats.hotspots}>
        <button type="button" disabled={dir === ""} onClick={() => setDir("")}>
          {m.stats.root}
        </button>
        {dirTrail(dir).map((step) => (
          <span key={step.dir}>
            <span className={styles.sep}>/</span>
            <button type="button" disabled={step.dir === dir} onClick={() => setDir(step.dir)}>
              {step.name}
            </button>
          </span>
        ))}
      </nav>

      {activity.error && <p className={styles.note}>{activity.error}</p>}
      {activity.progress && <p className={styles.note}>{m.stats.reading(formatCount(activity.progress.done), formatCount(activity.progress.total))}</p>}
      {files && spots.length === 0 && <p className={styles.note}>{m.stats.noChanges}</p>}

      <ol className={styles.authors}>
        {shown.map((spot, i) => {
          const main = spot.authors[0];
          const share = main ? Math.round((main.commits / spot.commits) * 100) : 0;
          return (
            <li key={spot.path} className={styles.author}>
              <button
                type="button"
                className={`${styles.authorMain} ${styles.spotMain}`}
                title={spot.isDir ? `${spot.path}\n${m.stats.openDir}` : `${spot.path}\n${m.stats.showChanges}`}
                onClick={() => (spot.isDir ? open(spot) : onSearch(pathSearch(spot)))}
              >
                <span className={styles.rank}>{i + 1}</span>
                <span className={`${styles.name} ${spot.isDir ? styles.dirName : ""}`}>{spot.name}</span>
                <span className={styles.bar}>
                  <span style={{ width: `${(spot.commits / top) * 100}%` }} />
                </span>
                <span className={styles.count}>{formatCount(spot.commits)}</span>
                <span className={styles.share} title={main ? m.stats.mainAuthorTitle(main.name, main.commits, spot.commits) : undefined}>
                  {main ? m.stats.mainAuthor(main.name, String(share)) : ""}
                </span>
                <span className={styles.seen}>
                  {m.stats.authorsCount(spot.authors.length)}
                  {spot.last !== null && ` · ${m.stats.changed(formatAgo(spot.last, now, m))}`}
                </span>
              </button>
              <button type="button" className={styles.showCommits} aria-label={m.stats.showChanges} title={m.stats.showChanges} onClick={() => onSearch(pathSearch(spot))}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      {spots.length > TOP && (
        <button type="button" className={styles.more} onClick={() => setAll((on) => !on)}>
          {all ? m.stats.showFewer : m.stats.showAll(formatCount(spots.length))}
        </button>
      )}
    </section>
  );
}
