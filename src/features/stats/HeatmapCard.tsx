import { useMemo, useRef } from "react";
import { dateFormatter } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useElementWidth } from "../../lib/useElementWidth";
import { authorsOf } from "../commits/authors";
import type { GraphIndex } from "../graph/GraphIndex";
import type { HotspotPeriod } from "./HotspotsCard";
import { inPeriod } from "./HotspotsCard";
import { fileHeatmap, filesByCommit, monthSearch, type Heatmap } from "./hotspots";
import { level } from "./stats";
import type { FileActivityState } from "./useFileActivity";
import styles from "./StatsView.module.css";

/** Rows of the heatmap: the most changed entries of the directory. */
const ROWS = 15;
const LABELS_W = 180;
const MONTHS_H = 16;
const ROW_H = 20;
/** Narrowest and widest month column; below the narrowest the chart scrolls. */
const MIN_STEP = 8;
const MAX_STEP = 28;

const monthYear = dateFormatter({ month: "long", year: "numeric" });

interface HeatmapCardProps {
  index: GraphIndex;
  version: number;
  activity: FileActivityState;
  author: string | null;
  /** The directory of the hotspots, whose entries are the rows. */
  dir: string;
  onDir: (dir: string) => void;
  period: HotspotPeriod;
  onSearch: (text: string) => void;
}

/** When the most changed files and directories changed, month by month. */
export function HeatmapCard({ index, version, activity, author, dir, onDir, period, onSearch }: HeatmapCardProps) {
  const m = useT();
  const files = useMemo(() => (activity.activity ? filesByCommit(activity.activity) : null), [activity.activity]);
  const map = useMemo(() => {
    if (!files) return null;
    const when = inPeriod(period);
    return fileHeatmap(index.commits, files, dir, ROWS, (c) => (author === null || authorsOf(c).includes(author)) && when(c));
    // `version` stands for the contents of `index`, which is mutated in place.
  }, [files, index, version, dir, period, author]);

  if (!map || map.months.length === 0) return null;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{m.stats.heatmap}</h2>
        <span className={styles.note}>{m.stats.heatmapNote}</span>
      </div>
      <HeatmapChart map={map} onDir={onDir} onSearch={onSearch} />
    </section>
  );
}

/** The chart itself, mounted only when there is something to draw, so its width is measured. */
function HeatmapChart({ map, onDir, onSearch }: { map: Heatmap; onDir: (dir: string) => void; onSearch: (text: string) => void }) {
  const m = useT();
  const box = useRef<HTMLDivElement>(null);
  const width = useElementWidth(box);
  const step = Math.min(MAX_STEP, Math.max(MIN_STEP, Math.floor((width - LABELS_W) / map.months.length)));
  const gap = step >= 14 ? 2 : 1;
  const chartW = LABELS_W + map.months.length * step;
  const chartH = MONTHS_H + map.rows.length * ROW_H;
  // A year label on each January (and on the first month), when there is room for it.
  const yearAt = map.months.flatMap((month, i) => (i === 0 || month.key.endsWith("-01") ? [{ i, year: month.key.slice(0, 4) }] : []));

  return (
    <div ref={box} className={styles.scroll}>
      <svg className={styles.chart} width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} role="img" aria-label={m.stats.heatmap}>
        {yearAt.map(({ i, year }, n) => {
          const next = yearAt[n + 1]?.i ?? map.months.length;
          if ((next - i) * step < 34) return null;
          return (
            <text key={year} className={styles.axis} x={LABELS_W + i * step} y={10}>
              {year}
            </text>
          );
        })}
        {map.rows.map((row, r) => {
          const y = MONTHS_H + r * ROW_H;
          return (
            <g key={row.spot.path}>
              <text
                className={`${styles.heatLabel} ${row.spot.isDir ? styles.heatDir : ""}`}
                x={0}
                y={y + ROW_H / 2 + 4}
                onClick={row.spot.isDir ? () => onDir(row.spot.path) : undefined}
              >
                <title>{row.spot.path}</title>
                {row.spot.name.length > 26 ? `${row.spot.name.slice(0, 25)}…` : row.spot.name}
              </text>
              {row.counts.map((count, i) => {
                const month = map.months[i];
                if (!month) return null;
                return (
                  <rect
                    key={month.key}
                    className={styles.day}
                    data-level={level(count, map.max)}
                    x={LABELS_W + i * step}
                    y={y + 2}
                    width={step - gap}
                    height={ROW_H - 4}
                    rx={2}
                    onClick={count > 0 ? () => onSearch(monthSearch(row.spot, month)) : undefined}
                    style={count > 0 ? { cursor: "pointer" } : undefined}
                  >
                    <title>{m.stats.heatmapCell(count, row.spot.path, monthYear().format(new Date(month.start * 1000)))}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
