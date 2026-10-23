import { describe, expect, it } from "vitest";
import type { CommitSummary } from "../../lib/bindings";
import { parseQuery, matchCommits } from "../search/query";
import { CALENDAR_MIN_STEP, PUNCH_MAX_ROW, PUNCH_MIN_STEP, calendar, calendarPeriod, calendarStep, dayKey, daySearch, level, punchSteps, repoStats, weekday } from "./stats";

/** Unix seconds of a local date and time. */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime() / 1000;
}

function commit(id: string, author: string, time: number | null, parents: string[] = []): CommitSummary {
  return { id, summary: id, author, time, parents };
}

describe("repoStats", () => {
  const commits = [
    commit("d", "Bruno", at(2026, 3, 2, 9), ["c", "x"]),
    commit("c", "Anna", at(2026, 3, 2, 18), ["b"]),
    commit("b", "Anna", at(2025, 12, 31, 23), ["a"]),
    commit("a", "Carla", null),
  ];

  it("counts commits by author, most first", () => {
    const stats = repoStats(commits);
    expect(stats.commits).toBe(4);
    expect(stats.merges).toBe(1);
    expect(stats.authors.map((a) => [a.name, a.commits])).toEqual([
      ["Anna", 2],
      ["Bruno", 1],
      ["Carla", 1],
    ]);
    expect(stats.authors[0]).toMatchObject({ first: at(2025, 12, 31, 23), last: at(2026, 3, 2, 18) });
    expect(stats.authors[2]).toMatchObject({ first: null, last: null });
  });

  it("counts days, weekdays and hours in local time", () => {
    const stats = repoStats(commits);
    expect(stats.days.get("2026-03-02")).toBe(2);
    expect(stats.days.get("2025-12-31")).toBe(1);
    expect(stats.years).toEqual([2026, 2025]);
    expect(stats.first).toBe(at(2025, 12, 31, 23));
    expect(stats.last).toBe(at(2026, 3, 2, 18));
    // 2 March 2026 is a Monday, 31 December 2025 a Wednesday.
    expect(stats.punch[0 * 24 + 9]).toBe(1);
    expect(stats.punch[0 * 24 + 18]).toBe(1);
    expect(stats.punch[2 * 24 + 23]).toBe(1);
    expect(stats.punch.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("credits co-authors, once each", () => {
    const shared = [
      { ...commit("b", "Bruno", at(2026, 3, 3), ["a"]), coAuthors: ["Anna", "Bruno"] },
      commit("a", "Anna", at(2026, 3, 1)),
    ];
    const stats = repoStats(shared);
    expect(stats.commits).toBe(2);
    expect(stats.coAuthored).toBe(1);
    expect(stats.authors.map((a) => [a.name, a.commits, a.coAuthored])).toEqual([
      ["Anna", 2, 1],
      ["Bruno", 1, 0],
    ]);
    expect(stats.authors[0]).toMatchObject({ first: at(2026, 3, 1), last: at(2026, 3, 3) });
    expect(stats.days.get("2026-03-03")).toBe(1);
  });

  it("keeps only the commits asked for", () => {
    const stats = repoStats(commits, (c) => c.author === "Anna");
    expect(stats.commits).toBe(2);
    expect(stats.authors.map((a) => a.name)).toEqual(["Anna"]);
  });
});

describe("level", () => {
  it("goes from 0 for nothing to 4 for the busiest", () => {
    expect(level(0, 10)).toBe(0);
    expect(level(1, 100)).toBe(1);
    expect(level(10, 10)).toBe(4);
    expect(level(3, 12)).toBe(2);
  });
});

describe("calendar", () => {
  it("lays the days out in weeks from Monday, marking those outside the period", () => {
    // 1 January 2026 is a Thursday, 31 December a Thursday.
    const { start, end } = calendarPeriod(2026, new Date(2026, 5, 1));
    const days = new Map([
      ["2026-01-01", 2],
      ["2026-03-02", 8],
      ["2025-12-31", 5],
    ]);
    const cal = calendar(days, start, end);
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true);
    expect(cal.weeks[0]?.[0]?.key).toBe("2025-12-29");
    expect(cal.weeks[0]?.[2]).toMatchObject({ key: "2025-12-31", outside: true, count: 0 });
    expect(cal.weeks[0]?.[3]).toMatchObject({ key: "2026-01-01", next: "2026-01-02", outside: false, count: 2, level: 2 });
    expect(cal.weeks[cal.weeks.length - 1]?.[6]?.key).toBe("2027-01-03");
    expect(cal.weeks.length).toBe(53);
    expect(cal.total).toBe(10);
    expect(cal.activeDays).toBe(2);
    expect(cal.months.map((m) => m.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(cal.months[0]?.week).toBe(0);
  });

  it("ends the last 12 months with today", () => {
    const { start, end } = calendarPeriod("last", new Date(2026, 9, 21, 15));
    expect(dayKey(start)).toBe("2025-10-22");
    expect(dayKey(end)).toBe("2026-10-22");
    const cal = calendar(new Map([["2026-10-21", 1]]), start, end);
    const today = cal.weeks.flat().find((d) => d.key === "2026-10-21");
    expect(today).toMatchObject({ outside: false, count: 1 });
    expect(cal.weeks.flat().find((d) => d.key === "2026-10-22")?.outside).toBe(true);
  });

  it("skips no day when the clocks change", () => {
    const { start, end } = calendarPeriod(2026, new Date());
    const keys = calendar(new Map(), start, end)
      .weeks.flat()
      .filter((d) => !d.outside)
      .map((d) => d.key);
    expect(keys.length).toBe(365);
    expect(new Set(keys).size).toBe(365);
  });
});

describe("daySearch", () => {
  it("finds the commits of that day, of that author", () => {
    const commits = [
      commit("a", "Anna Rossi", at(2026, 3, 2, 0)),
      commit("b", "Anna Rossi", at(2026, 3, 3, 0)),
      commit("c", "Bruno", at(2026, 3, 2, 23)),
    ];
    const day = { key: "2026-03-02", next: "2026-03-03" };
    const all = parseQuery(daySearch(day, null));
    const anna = parseQuery(daySearch(day, "Anna Rossi"));
    if (!all || !anna || "error" in all || "error" in anna) throw new Error("not a query");
    expect(matchCommits(commits, all)).toEqual(["a", "c"]);
    expect(matchCommits(commits, anna)).toEqual(["a"]);
  });
});

it("numbers weekdays from Monday", () => {
  expect(weekday(new Date(2026, 9, 19))).toBe(0);
  expect(weekday(new Date(2026, 9, 25))).toBe(6);
});

describe("chart sizes", () => {
  it("fills the width with square calendar cells", () => {
    expect(calendarStep(32 + 53 * 30, 53, 32)).toBe(30);
    expect(calendarStep(32 + 53 * 30 + 20, 53, 32)).toBe(30);
  });

  it("keeps a minimum calendar step and scrolls below it", () => {
    expect(calendarStep(300, 53, 32)).toBe(CALENDAR_MIN_STEP);
    expect(calendarStep(0, 53, 32)).toBe(CALENDAR_MIN_STEP);
    expect(calendarStep(500, 0, 32)).toBe(CALENDAR_MIN_STEP);
  });

  it("spreads the punch card hours and caps its rows", () => {
    expect(punchSteps(32 + 24 * 30, 32)).toEqual({ column: 30, row: 30 });
    expect(punchSteps(32 + 24 * 75, 32)).toEqual({ column: 75, row: PUNCH_MAX_ROW });
    expect(punchSteps(200, 32)).toEqual({ column: PUNCH_MIN_STEP, row: PUNCH_MIN_STEP });
  });
});
