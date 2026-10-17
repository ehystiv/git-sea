import type { CommitSummary } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";

/**
 * A condition the frontend checks on the commits it has. `text` (no prefix) matches the subject,
 * the author or the start of the hash; dates are Unix seconds.
 */
export type LocalTerm =
  | { kind: "text"; text: string }
  | { kind: "author"; text: string }
  | { kind: "hash"; text: string }
  | { kind: "regex"; source: string; re: RegExp }
  | { kind: "after"; time: number }
  | { kind: "before"; time: number };

/** A condition only the backend can check: it reads the whole message, the trees or the blobs. */
export interface BackendTerm {
  kind: "message" | "path" | "diff";
  text: string;
}

/** Every term must hold. At most one of them runs in the backend. */
export interface SearchQuery {
  local: LocalTerm[];
  backend: BackendTerm | null;
  /** Equal for equal queries, whatever the spacing. */
  key: string;
}

export type QueryError = { kind: "date"; value: string } | { kind: "regex"; value: string } | { kind: "twoBackend" };

type Key = "author" | "hash" | "message" | "path" | "diff" | "regex" | "after" | "before";

const PREFIXES: Record<string, Key> = {
  author: "author",
  autore: "author",
  hash: "hash",
  msg: "message",
  message: "message",
  messaggio: "message",
  path: "path",
  file: "path",
  diff: "diff",
  re: "regex",
  regex: "regex",
  after: "after",
  since: "after",
  dopo: "after",
  before: "before",
  until: "before",
  prima: "before",
};

/** A known prefix at the start or after a space: everything up to the next one is its value. */
const PREFIX = new RegExp(`(^|\\s)(${Object.keys(PREFIXES).join("|")}):`, "gi");

/** Help shown under the search field, one line per prefix. */
export function searchHelp(m: Messages = t()): Array<{ prefix: string; meaning: string }> {
  return [
    { prefix: "", meaning: m.search.help.text },
    { prefix: "author:", meaning: m.search.help.author },
    { prefix: "hash:", meaning: m.search.help.hash },
    { prefix: "msg:", meaning: m.search.help.msg },
    { prefix: "path:", meaning: m.search.help.path },
    { prefix: "diff:", meaning: m.search.help.diff },
    { prefix: "after: before:", meaning: m.search.help.dates },
    { prefix: "re:", meaning: m.search.help.regex },
  ];
}

const DAY = 86_400;
const UNITS: Record<string, number> = { d: DAY, g: DAY, w: 7 * DAY, s: 7 * DAY, m: 30 * DAY, y: 365 * DAY, a: 365 * DAY };

/**
 * Unix seconds for `2024`, `2024-05`, `2024-05-17` (the start of that period, local time),
 * `today`/`oggi`, `yesterday`/`ieri`, or a time ago such as `3d`, `2w`, `6m`, `1y` (`g`, `s`, `a`
 * in Italian). Null when it is none of those.
 */
export function parseDate(value: string, now: number): number | null {
  const text = value.trim().toLowerCase();
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
  };
  if (text === "today" || text === "oggi") return startOfDay(now);
  if (text === "yesterday" || text === "ieri") return startOfDay(now) - DAY;
  const ago = /^(\d+)\s*([dgwsmya])$/.exec(text);
  if (ago) return Math.floor(now / 1000) - Number(ago[1]) * (UNITS[ago[2] ?? ""] ?? DAY);
  const date = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text);
  if (!date) return null;
  const month = Number(date[2] ?? 1);
  const day = Number(date[3] ?? 1);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Number(date[1]), month - 1, day).getTime() / 1000;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^".*"$/.test(trimmed) && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}

/**
 * Reads `author:Anna Rossi after:2024-05 login`: plain words first, then prefixed terms, each
 * running to the next prefix (quotes are optional). Unknown prefixes such as `fix:` are plain
 * text. Null when there is nothing to look for.
 */
export function parseQuery(raw: string, now: number = Date.now()): SearchQuery | { error: QueryError } | null {
  const marks = [...raw.matchAll(PREFIX)].map((match) => ({
    key: PREFIXES[(match[2] ?? "").toLowerCase()] ?? "path",
    start: (match.index ?? 0) + (match[1] ?? "").length,
    valueStart: (match.index ?? 0) + match[0].length,
  }));
  const local: LocalTerm[] = [];
  let backend: BackendTerm | null = null;

  const free = raw.slice(0, marks[0]?.start ?? raw.length).trim();
  if (free !== "") local.push({ kind: "text", text: free });

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (!mark) continue;
    const value = unquote(raw.slice(mark.valueStart, marks[i + 1]?.start ?? raw.length));
    if (value === "") continue;
    switch (mark.key) {
      case "author":
      case "hash":
        local.push({ kind: mark.key, text: value });
        break;
      case "after":
      case "before": {
        const time = parseDate(value, now);
        if (time === null) return { error: { kind: "date", value } };
        local.push({ kind: mark.key, time });
        break;
      }
      case "regex":
        try {
          local.push({ kind: "regex", source: value, re: new RegExp(value, "i") });
        } catch {
          return { error: { kind: "regex", value } };
        }
        break;
      default:
        if (backend) return { error: { kind: "twoBackend" } };
        backend = { kind: mark.key, text: value };
    }
  }

  if (local.length === 0 && backend === null) return null;
  const key = JSON.stringify([local.map((term) => ("re" in term ? [term.kind, term.source] : term)), backend]);
  return { local, backend, key };
}

/** A query of plain words, as typed in the palette. */
export function textQuery(text: string): SearchQuery {
  return { local: [{ kind: "text", text }], backend: null, key: JSON.stringify(["text", text]) };
}

const HEX = /^[0-9a-f]{4,40}$/;

function termMatcher(term: LocalTerm): (commit: CommitSummary) => boolean {
  switch (term.kind) {
    case "text": {
      const needle = term.text.toLowerCase();
      const hash = HEX.test(needle) ? needle : null;
      return (c) => c.summary.toLowerCase().includes(needle) || c.author.toLowerCase().includes(needle) || (hash !== null && c.id.startsWith(hash));
    }
    case "author": {
      const needle = term.text.toLowerCase();
      return (c) => c.author.toLowerCase().includes(needle);
    }
    case "hash": {
      const needle = term.text.toLowerCase();
      return (c) => c.id.startsWith(needle);
    }
    case "regex":
      return (c) => term.re.test(c.summary) || term.re.test(c.author);
    case "after":
      return (c) => c.time !== null && c.time >= term.time;
    case "before":
      return (c) => c.time !== null && c.time < term.time;
  }
}

/** A test for one commit: every local term of the query must hold. */
export function commitMatcher(query: SearchQuery): (commit: CommitSummary) => boolean {
  const tests = query.local.map(termMatcher);
  return (commit) => tests.every((test) => test(commit));
}

/** Ids of the matching commits, in the order of `commits` (newest first in the walk). */
export function matchCommits(commits: readonly CommitSummary[], query: SearchQuery, limit = Infinity): string[] {
  const test = commitMatcher(query);
  const ids: string[] = [];
  for (const commit of commits) {
    if (!test(commit)) continue;
    ids.push(commit.id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/** `ids` (in any order) sorted by their position, dropping those `position` does not know. */
export function inWalkOrder(ids: readonly string[], position: (id: string) => number | null): string[] {
  const placed: Array<[number, string]> = [];
  for (const id of ids) {
    const at = position(id);
    if (at !== null) placed.push([at, id]);
  }
  placed.sort((a, b) => a[0] - b[0]);
  return placed.map(([, id]) => id);
}

/** The match after (or before, with `step` -1) the current one, wrapping around. */
export function stepMatch(count: number, current: number | null, step: 1 | -1): number | null {
  if (count === 0) return null;
  if (current === null) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}
