export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact age of a Unix timestamp: 5m, 3h, 2g, 3sett, 4mesi, 2a. */
export function formatRelative(unixSeconds: number, nowMs: number = Date.now()): string {
  const age = Math.max(0, nowMs / 1000 - unixSeconds);
  if (age < HOUR) return `${Math.max(1, Math.floor(age / MINUTE))}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < WEEK) return `${Math.floor(age / DAY)}g`;
  if (age < MONTH) return `${Math.floor(age / WEEK)}sett`;
  if (age < YEAR) return `${Math.floor(age / MONTH)}mesi`;
  return `${Math.floor(age / YEAR)}a`;
}

const dateTime = new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" });

/** "12 ott 2026, 14:21" */
export function formatDateTime(unixSeconds: number): string {
  return dateTime.format(new Date(unixSeconds * 1000));
}

const relative = new Intl.RelativeTimeFormat("it", { numeric: "auto" });

/** "2 giorni fa", "ieri", "3 mesi fa" */
export function formatAgo(unixSeconds: number, nowMs: number = Date.now()): string {
  const age = Math.max(0, nowMs / 1000 - unixSeconds);
  if (age < MINUTE) return "adesso";
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), "minute");
  if (age < DAY) return relative.format(-Math.floor(age / HOUR), "hour");
  if (age < MONTH) return relative.format(-Math.floor(age / DAY), "day");
  if (age < YEAR) return relative.format(-Math.floor(age / MONTH), "month");
  return relative.format(-Math.floor(age / YEAR), "year");
}

/** Splits "src/app/main.ts" into ["src/app/", "main.ts"]. */
export function splitPath(path: string): [dir: string, name: string] {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ["", path] : [path.slice(0, slash + 1), path.slice(slash + 1)];
}
