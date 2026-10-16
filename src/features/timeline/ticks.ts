export interface Tick {
  /** Unix seconds. */
  time: number;
  label: string;
  /** Starts a larger unit (a new day, month or year), drawn stronger. */
  major: boolean;
}

type Unit = "hour" | "day" | "week" | "month" | "year";

interface Step {
  unit: Unit;
  n: number;
  /** Rough length, to pick the step and to guard against too many ticks. */
  seconds: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const STEPS: Step[] = [
  { unit: "hour", n: 1, seconds: HOUR },
  { unit: "hour", n: 3, seconds: 3 * HOUR },
  { unit: "hour", n: 6, seconds: 6 * HOUR },
  { unit: "hour", n: 12, seconds: 12 * HOUR },
  { unit: "day", n: 1, seconds: DAY },
  { unit: "week", n: 1, seconds: 7 * DAY },
  { unit: "month", n: 1, seconds: 30 * DAY },
  { unit: "month", n: 3, seconds: 91 * DAY },
  { unit: "month", n: 6, seconds: 182 * DAY },
  { unit: "year", n: 1, seconds: 365 * DAY },
  { unit: "year", n: 2, seconds: 730 * DAY },
  { unit: "year", n: 5, seconds: 5 * 365 * DAY },
  { unit: "year", n: 10, seconds: 10 * 365 * DAY },
  { unit: "year", n: 25, seconds: 25 * 365 * DAY },
  { unit: "year", n: 100, seconds: 100 * 365 * DAY },
];

const MAX_TICKS = 400;
const monthShort = new Intl.DateTimeFormat("it-IT", { month: "short" });
const dayMonth = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
const monthYear = new Intl.DateTimeFormat("it-IT", { month: "short", year: "numeric" });
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Calendar ticks (local time) for the window [t0, t1], at least `minGapPx` apart on screen.
 * The unit grows with the zoom out: hours, days, weeks, months, years.
 */
export function timeTicks(t0: number, t1: number, pxPerSecond: number, minGapPx = 84): Tick[] {
  const step = STEPS.find((s) => s.seconds * pxPerSecond >= minGapPx && (t1 - t0) / s.seconds <= MAX_TICKS) ?? STEPS[STEPS.length - 1];
  if (!step || !(t1 > t0)) return [];

  const ticks: Tick[] = [];
  const d = new Date(t0 * 1000);
  switch (step.unit) {
    case "hour":
      d.setMinutes(0, 0, 0);
      d.setHours(Math.floor(d.getHours() / step.n) * step.n);
      break;
    case "day":
      d.setHours(0, 0, 0, 0);
      break;
    case "week":
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      break;
    case "month":
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      d.setMonth(Math.floor(d.getMonth() / step.n) * step.n);
      break;
    case "year":
      d.setHours(0, 0, 0, 0);
      d.setMonth(0, 1);
      d.setFullYear(Math.floor(d.getFullYear() / step.n) * step.n);
      break;
  }

  for (let guard = 0; guard < MAX_TICKS * 2 && d.getTime() / 1000 <= t1; guard++) {
    const time = d.getTime() / 1000;
    if (time >= t0 - step.seconds) ticks.push(describe(d, step, time));
    switch (step.unit) {
      case "hour":
        d.setHours(d.getHours() + step.n);
        break;
      case "day":
        d.setDate(d.getDate() + step.n);
        break;
      case "week":
        d.setDate(d.getDate() + 7 * step.n);
        break;
      case "month":
        d.setMonth(d.getMonth() + step.n);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + step.n);
        break;
    }
  }
  return ticks;
}

function describe(d: Date, step: Step, time: number): Tick {
  switch (step.unit) {
    case "hour":
      return d.getHours() === 0
        ? { time, label: dayMonth.format(d), major: true }
        : { time, label: `${pad(d.getHours())}:${pad(d.getMinutes())}`, major: false };
    case "day":
    case "week":
      return { time, label: dayMonth.format(d), major: d.getDate() === 1 };
    case "month":
      return d.getMonth() === 0
        ? { time, label: String(d.getFullYear()), major: true }
        : { time, label: step.n === 1 ? monthShort.format(d) : monthYear.format(d), major: false };
    case "year":
      return { time, label: String(d.getFullYear()), major: true };
  }
}
