import { intlLocale, t, type Messages } from "./i18n";

export function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact age of a Unix timestamp: 5m, 3h, 2d, 3w, 4mo, 2y (in Italian 2g, 3sett, 4mesi, 2a). */
export function formatRelative(unixSeconds: number, nowMs: number = Date.now(), m: Messages = t()): string {
  const age = Math.max(0, nowMs / 1000 - unixSeconds);
  if (age < HOUR) return m.time.minutes(Math.max(1, Math.floor(age / MINUTE)));
  if (age < DAY) return m.time.hours(Math.floor(age / HOUR));
  if (age < WEEK) return m.time.days(Math.floor(age / DAY));
  if (age < MONTH) return m.time.weeks(Math.floor(age / WEEK));
  if (age < YEAR) return m.time.months(Math.floor(age / MONTH));
  return m.time.years(Math.floor(age / YEAR));
}

/** An `Intl` formatter for the current UI locale, made once per locale. */
function cached<F>(make: (locale: string) => F): () => F {
  const byLocale = new Map<string, F>();
  return () => {
    const locale = intlLocale();
    let formatter = byLocale.get(locale);
    if (!formatter) {
      formatter = make(locale);
      byLocale.set(locale, formatter);
    }
    return formatter;
  };
}

/** A formatter, in the UI locale, for `options`: for code that formats dates its own way. */
export function dateFormatter(options: Intl.DateTimeFormatOptions): () => Intl.DateTimeFormat {
  return cached((locale) => new Intl.DateTimeFormat(locale, options));
}

const dateTime = dateFormatter({ dateStyle: "medium", timeStyle: "short" });
const relative = cached((locale) => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
const integer = cached((locale) => new Intl.NumberFormat(locale));

/** "Oct 12, 2026, 2:21 PM", "12 ott 2026, 14:21" */
export function formatDateTime(unixSeconds: number): string {
  return dateTime().format(new Date(unixSeconds * 1000));
}

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
const sizes = UNITS.map((unit) => cached((locale) => new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1 })));

/** "740 kB", "17.4 MB" ("17,4 MB" in Italian): a size in bytes, in the unit that fits. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return (sizes[unit] ?? sizes[0])?.().format(value) ?? `${bytes} B`;
}

/** "1,284" or "1.284", by the UI locale. */
export function formatCount(n: number): string {
  return integer().format(n);
}

/** "2 days ago", "yesterday", "3 months ago" (in Italian "2 giorni fa", "ieri"…) */
export function formatAgo(unixSeconds: number, nowMs: number = Date.now(), m: Messages = t()): string {
  const age = Math.max(0, nowMs / 1000 - unixSeconds);
  if (age < MINUTE) return m.time.now;
  if (age < HOUR) return relative().format(-Math.floor(age / MINUTE), "minute");
  if (age < DAY) return relative().format(-Math.floor(age / HOUR), "hour");
  if (age < MONTH) return relative().format(-Math.floor(age / DAY), "day");
  if (age < YEAR) return relative().format(-Math.floor(age / MONTH), "month");
  return relative().format(-Math.floor(age / YEAR), "year");
}

/** Splits "src/app/main.ts" into ["src/app/", "main.ts"]. */
export function splitPath(path: string): [dir: string, name: string] {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ["", path] : [path.slice(0, slash + 1), path.slice(slash + 1)];
}
