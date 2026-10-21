import type { CommitSummary } from "../../lib/bindings";

/** Commits of one author (as named after the mailmap). */
export interface AuthorStats {
  name: string;
  commits: number;
  /** Unix seconds of the oldest and newest commit, or null when none has a date. */
  first: number | null;
  last: number | null;
}

/** Counts over a set of commits, all in local time. */
export interface RepoStats {
  commits: number;
  merges: number;
  /** Most commits first, then by name. */
  authors: AuthorStats[];
  /** Local day (`dayKey`) -> commits on it. */
  days: Map<string, number>;
  /** Commits by weekday and hour: index `weekday * 24 + hour`, Monday being 0. */
  punch: number[];
  first: number | null;
  last: number | null;
  /** Years with commits, newest first. */
  years: number[];
}

/** "2026-10-21": the local day of a date, as `after:`/`before:` read it. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 0 for Monday … 6 for Sunday. */
export function weekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Counts the commits for which `include` holds (all of them by default). */
export function repoStats(commits: readonly CommitSummary[], include: (commit: CommitSummary) => boolean = () => true): RepoStats {
  const byAuthor = new Map<string, AuthorStats>();
  const days = new Map<string, number>();
  const punch = new Array<number>(7 * 24).fill(0);
  const years = new Set<number>();
  let count = 0;
  let merges = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const commit of commits) {
    if (!include(commit)) continue;
    count++;
    if (commit.parents.length > 1) merges++;
    let author = byAuthor.get(commit.author);
    if (!author) {
      author = { name: commit.author, commits: 0, first: null, last: null };
      byAuthor.set(commit.author, author);
    }
    author.commits++;
    const time = commit.time;
    if (time === null || !Number.isFinite(time)) continue;
    if (author.first === null || time < author.first) author.first = time;
    if (author.last === null || time > author.last) author.last = time;
    if (first === null || time < first) first = time;
    if (last === null || time > last) last = time;
    const date = new Date(time * 1000);
    const key = dayKey(date);
    days.set(key, (days.get(key) ?? 0) + 1);
    const at = weekday(date) * 24 + date.getHours();
    punch[at] = (punch[at] ?? 0) + 1;
    years.add(date.getFullYear());
  }

  const authors = [...byAuthor.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return { commits: count, merges, authors, days, punch, first, last, years: [...years].sort((a, b) => b - a) };
}

/** Shade of a count from 0 (none) to 4 (the most). The square root keeps one busy day from fading all the others. */
export function level(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(4 * Math.sqrt(count / max))));
}

export interface CalendarDay {
  /** `dayKey` of the day; the search for it is `after:<key> before:<next>`. */
  key: string;
  /** `dayKey` of the day after. */
  next: string;
  /** Unix seconds of its local midnight. */
  time: number;
  count: number;
  level: number;
  /** Outside the chosen period: drawn only to complete the first and last week. */
  outside: boolean;
}

export interface Calendar {
  /** Columns of seven days, Monday first. */
  weeks: CalendarDay[][];
  /** The column where each month starts, with the month (0–11). */
  months: Array<{ week: number; month: number }>;
  /** Commits in the period. */
  total: number;
  /** Days of the period with at least one commit. */
  activeDays: number;
}

/** The period a calendar shows: a year, or the 12 months up to today. `end` is excluded. */
export function calendarPeriod(year: number | "last", now: Date): { start: Date; end: Date } {
  if (year === "last") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start: new Date(end.getFullYear() - 1, end.getMonth(), end.getDate()), end };
  }
  return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
}

/** The days from `start` to `end` (excluded) in weeks, with the commits on each. */
export function calendar(days: ReadonlyMap<string, number>, start: Date, end: Date): Calendar {
  const weeks: CalendarDay[][] = [];
  const months: Calendar["months"] = [];
  let total = 0;
  let activeDays = 0;
  let max = 0;
  const startKey = dayKey(start);
  const endKey = dayKey(end);
  // Days are stepped by date, not by 24 hours, so a change of daylight saving time skips nothing.
  let day = new Date(start.getFullYear(), start.getMonth(), start.getDate() - weekday(start));
  let lastMonth = -1;
  for (;;) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const key = dayKey(day);
      const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const outside = key < startKey || key >= endKey;
      const count = outside ? 0 : (days.get(key) ?? 0);
      if (!outside && day.getMonth() !== lastMonth) {
        lastMonth = day.getMonth();
        months.push({ week: weeks.length, month: lastMonth });
      }
      total += count;
      if (count > 0) activeDays++;
      max = Math.max(max, count);
      week.push({ key, next: dayKey(next), time: day.getTime() / 1000, count, level: 0, outside });
      day = next;
    }
    weeks.push(week);
    if (dayKey(day) >= endKey) break;
  }
  for (const week of weeks) for (const cell of week) cell.level = level(cell.count, max);
  return { weeks, months, total, activeDays };
}

/** The search for the commits of one day, of one author when given. */
export function daySearch(day: Pick<CalendarDay, "key" | "next">, author: string | null): string {
  return `${author === null ? "" : `author:${author} `}after:${day.key} before:${day.next}`;
}
