import { useMemo, useRef, useState } from "react";
import { dateFormatter, formatAgo, formatCount } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useElementWidth } from "../../lib/useElementWidth";
import type { GraphIndex } from "../graph/GraphIndex";
import { authorsOf } from "../commits/authors";
import { HotspotsCard } from "./HotspotsCard";
import { TypesCard } from "./TypesCard";
import { useFileActivity } from "./useFileActivity";
import { calendar, calendarPeriod, calendarStep, daySearch, level, punchSteps, repoStats, type AuthorStats, type CalendarDay, type RepoStats } from "./stats";
import styles from "./StatsView.module.css";

/** Authors listed before "Show all". */
const TOP_AUTHORS = 20;
/** Room on the left of the calendar and the punch card for the weekday names. */
const LABELS_W = 32;
const MONTHS_H = 16;
const HOURS_H = 18;

const dayDate = dateFormatter({ dateStyle: "medium" });
const monthYear = dateFormatter({ month: "short", year: "numeric" });
const monthName = dateFormatter({ month: "short" });
const weekdayName = dateFormatter({ weekday: "short" });
const hourName = dateFormatter({ hour: "numeric" });

/** 1 January 2024 was a Monday: the names of the weekdays, Monday first, in the UI locale. */
function weekdayNames(): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayName().format(new Date(2024, 0, 1 + i)));
}

function hourLabel(hour: number): string {
  return hourName().format(new Date(2024, 0, 1, hour));
}

interface StatsViewProps {
  sessionId: string;
  index: GraphIndex;
  /** Changes whenever `index` gets new data. */
  version: number;
  loading: boolean;
  /** The branches the history is limited to, described, or null for all of it. */
  filter: string | null;
  /** Shows the commits a search finds. */
  onSearch: (text: string) => void;
}

export function StatsView({ sessionId, index, version, loading, filter, onSearch }: StatsViewProps) {
  const m = useT();
  // Asked for again when the history is loaded again (the refs map is replaced then).
  const activity = useFileActivity(sessionId, !loading, index.refs);
  const [focus, setFocus] = useState<string | null>(null);
  const [year, setYear] = useState<number | "last">("last");
  const [allAuthors, setAllAuthors] = useState(false);

  const all = useMemo(() => repoStats(index.commits), [index, version]);
  const shown = useMemo(() => (focus === null ? all : repoStats(index.commits, (c) => authorsOf(c).includes(focus))), [all, index, version, focus]);
  // An author gone after a reload (a new .mailmap, another filter) cannot stay focused.
  const focused = focus !== null && all.authors.some((a) => a.name === focus) ? focus : null;
  const stats = focused === null ? all : shown;

  const now = useMemo(() => new Date(), [version]);
  const period = calendarPeriod(year, now);
  const cal = useMemo(() => calendar(stats.days, period.start, period.end), [stats, period.start.getTime(), period.end.getTime()]);

  if (all.commits === 0) {
    return (
      <div className={styles.view}>
        <p className={styles.empty}>{loading ? m.stats.loading : m.stats.empty}</p>
      </div>
    );
  }

  // An author idle for over a year would leave the last 12 months empty: show their last year.
  const focusOn = (author: AuthorStats) => {
    if (author.name === focused) return setFocus(null);
    setFocus(author.name);
    if (author.last !== null && year === "last" && author.last < period.start.getTime() / 1000) {
      setYear(new Date(author.last * 1000).getFullYear());
    }
  };

  const authors = allAuthors ? all.authors : all.authors.slice(0, TOP_AUTHORS);
  const top = all.authors[0]?.commits ?? 1;

  return (
    <div className={styles.view} aria-label={m.stats.label}>
      <div className={styles.page}>
        <header className={styles.header}>
          <span className={styles.scope}>{filter === null ? m.stats.scope : m.repo.only(filter)}</span>
          {focused !== null && (
            <span className={styles.chip}>
              {m.stats.only(focused)}
              <button type="button" aria-label={m.stats.allAuthors} title={m.stats.allAuthors} onClick={() => setFocus(null)}>
                ×
              </button>
            </span>
          )}
          {loading && <span className={styles.loading}>{m.stats.loading}</span>}
        </header>

        <Tiles stats={stats} authors={all.authors.length} focused={focused !== null} />

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{m.stats.activity}</h2>
            <span className={styles.note}>{m.stats.total(formatCount(cal.total), formatCount(cal.activeDays))}</span>
            <select className={styles.select} aria-label={m.stats.year} value={String(year)} onChange={(e) => setYear(e.target.value === "last" ? "last" : Number(e.target.value))}>
              <option value="last">{m.stats.lastYear}</option>
              {all.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <CalendarChart weeks={cal.weeks} months={cal.months} onPick={(day) => onSearch(daySearch(day, focused))} />
          <div className={styles.legend}>
            <span className={styles.note}>{m.stats.dayHint}</span>
            <span className={styles.scale}>
              {m.stats.less}
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={styles.swatch} data-level={l} />
              ))}
              {m.stats.more}
            </span>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{m.stats.punch}</h2>
            <span className={styles.note}>{m.stats.punchNote}</span>
          </div>
          <PunchCard punch={stats.punch} />
        </section>

        <TypesCard index={index} version={version} author={focused} onSearch={onSearch} />

        <HotspotsCard index={index} version={version} activity={activity} author={focused} onSearch={onSearch} />

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>{m.stats.byAuthor}</h2>
            <span className={styles.note}>
              {m.stats.mailmap}
              {all.coAuthored > 0 && ` ${m.stats.coAuthorsNote}`}
            </span>
          </div>
          <ol className={styles.authors}>
            {authors.map((author, i) => (
              <AuthorRow
                key={author.name}
                rank={i + 1}
                author={author}
                total={all.commits}
                top={top}
                focused={author.name === focused}
                onFocus={() => focusOn(author)}
                onShowCommits={() => onSearch(`author:${author.name}`)}
              />
            ))}
          </ol>
          {all.authors.length > TOP_AUTHORS && (
            <button type="button" className={styles.more} onClick={() => setAllAuthors((on) => !on)}>
              {allAuthors ? m.stats.showFewer : m.stats.showAll(formatCount(all.authors.length))}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function Tiles({ stats, authors, focused }: { stats: RepoStats; authors: number; focused: boolean }) {
  const m = useT();
  const period =
    stats.first === null || stats.last === null
      ? m.stats.noDate
      : `${monthYear().format(new Date(stats.first * 1000))} – ${monthYear().format(new Date(stats.last * 1000))}`;
  return (
    <div className={styles.tiles}>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{m.stats.commits}</span>
        <span className={styles.tileValue}>{formatCount(stats.commits)}</span>
        {stats.merges > 0 && <span className={styles.note}>{m.stats.merges(formatCount(stats.merges))}</span>}
        {stats.coAuthored > 0 && <span className={styles.note}>{m.stats.coAuthored(formatCount(stats.coAuthored))}</span>}
      </div>
      {!focused && (
        <div className={styles.tile}>
          <span className={styles.tileLabel}>{m.stats.authors}</span>
          <span className={styles.tileValue}>{formatCount(authors)}</span>
        </div>
      )}
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{m.stats.activeDays}</span>
        <span className={styles.tileValue}>{formatCount(stats.days.size)}</span>
      </div>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>{m.stats.period}</span>
        <span className={`${styles.tileValue} ${styles.tileSmall}`}>{period}</span>
      </div>
    </div>
  );
}

function CalendarChart({ weeks, months, onPick }: { weeks: CalendarDay[][]; months: Array<{ week: number; month: number }>; onPick: (day: CalendarDay) => void }) {
  const m = useT();
  const names = weekdayNames();
  const box = useRef<HTMLDivElement>(null);
  const step = calendarStep(useElementWidth(box), weeks.length, LABELS_W);
  const gap = Math.max(3, Math.round(step / 5));
  const cell = step - gap;
  const width = LABELS_W + weeks.length * step - gap;
  const height = MONTHS_H + 7 * step - gap;
  return (
    <div ref={box} className={styles.scroll}>
      <svg className={styles.chart} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={m.stats.activity}>
        {months.map(({ week, month }, i) => {
          // A month starting in the last column of the previous label would overlap it.
          const nextWeek = months[i + 1]?.week ?? weeks.length;
          if (nextWeek - week < 2) return null;
          return (
            <text key={`${week}-${month}`} className={styles.axis} x={LABELS_W + week * step} y={10}>
              {monthName().format(new Date(2024, month, 1))}
            </text>
          );
        })}
        {[0, 2, 4].map((d) => (
          <text key={d} className={styles.axis} x={0} y={MONTHS_H + d * step + cell / 2 + 4}>
            {names[d]}
          </text>
        ))}
        {weeks.map((week, w) =>
          week.map((day, d) =>
            day.outside ? null : (
              <rect
                key={day.key}
                className={styles.day}
                data-level={day.level}
                x={LABELS_W + w * step}
                y={MONTHS_H + d * step}
                width={cell}
                height={cell}
                rx={Math.max(2, cell / 6)}
                onClick={day.count > 0 ? () => onPick(day) : undefined}
                style={day.count > 0 ? { cursor: "pointer" } : undefined}
              >
                <title>{m.stats.day(day.count, dayDate().format(new Date(day.time * 1000)))}</title>
              </rect>
            ),
          ),
        )}
      </svg>
    </div>
  );
}

function PunchCard({ punch }: { punch: number[] }) {
  const m = useT();
  const names = weekdayNames();
  const max = Math.max(1, ...punch);
  const box = useRef<HTMLDivElement>(null);
  const { column, row } = punchSteps(useElementWidth(box), LABELS_W);
  const width = LABELS_W + 24 * column;
  const height = 7 * row + HOURS_H;
  const radius = Math.min(column, row) / 2 - 2;
  return (
    <div ref={box} className={styles.scroll}>
      <svg className={styles.chart} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={m.stats.punch}>
        {names.map((name, d) => (
          <text key={name} className={styles.axis} x={0} y={d * row + row / 2 + 4}>
            {name}
          </text>
        ))}
        {Array.from({ length: 8 }, (_, i) => i * 3).map((hour) => (
          <text key={hour} className={styles.axis} x={LABELS_W + hour * column + column / 2} y={height - 4} textAnchor="middle">
            {hourLabel(hour)}
          </text>
        ))}
        {punch.map((count, at) => {
          const d = Math.floor(at / 24);
          const hour = at % 24;
          const cx = LABELS_W + hour * column + column / 2;
          const cy = d * row + row / 2;
          return (
            <g key={at}>
              <circle className={styles.slotBase} cx={cx} cy={cy} r={1.5} />
              {count > 0 && (
                <circle className={styles.slot} data-level={level(count, max)} cx={cx} cy={cy} r={Math.max(2.5, radius * Math.sqrt(count / max))}>
                  <title>{m.stats.slot(count, names[d] ?? "", hourLabel(hour))}</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface AuthorRowProps {
  rank: number;
  author: AuthorStats;
  total: number;
  /** Commits of the first author, the longest bar. */
  top: number;
  focused: boolean;
  onFocus: () => void;
  onShowCommits: () => void;
}

function AuthorRow({ rank, author, total, top, focused, onFocus, onShowCommits }: AuthorRowProps) {
  const m = useT();
  const percent = (author.commits / total) * 100;
  return (
    <li className={`${styles.author} ${focused ? styles.focused : ""}`}>
      <button
        type="button"
        className={styles.authorMain}
        aria-pressed={focused}
        title={author.coAuthored > 0 ? `${m.stats.focus}\n${m.stats.asCoAuthor(author.coAuthored)}` : m.stats.focus}
        onClick={onFocus}
      >
        <span className={styles.rank}>{rank}</span>
        <span className={styles.name}>{author.name}</span>
        <span className={styles.bar}>
          <span style={{ width: `${(author.commits / top) * 100}%` }} />
        </span>
        <span className={styles.count}>{formatCount(author.commits)}</span>
        <span className={styles.share}>{m.stats.share(percent < 1 ? percent.toFixed(1) : String(Math.round(percent)))}</span>
        <span className={styles.seen}>{author.last === null ? m.stats.noDate : m.stats.lastSeen(formatAgo(author.last))}</span>
      </button>
      <button type="button" className={styles.showCommits} aria-label={m.stats.showCommits} title={m.stats.showCommits} onClick={onShowCommits}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      </button>
    </li>
  );
}
