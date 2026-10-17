import type { DiffLine } from "../../lib/bindings";

/** A changed stretch of a line, as `[start, end)` offsets into its text. */
export type Range = [number, number];

/** Words, runs of whitespace and single punctuation marks. */
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/** Longer lines are left without word highlighting: the comparison is quadratic. */
const MAX_TOKENS = 400;
/**
 * Below this share of unchanged characters the two lines are unrelated, and marking almost
 * everything would only add noise.
 */
const MIN_SHARED = 0.35;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Offsets of the tokens not in `keep`, merged into ranges (whitespace between two changes joins them). */
function changedRanges(tokens: string[], keep: Uint8Array): Range[] {
  const ranges: Range[] = [];
  let at = 0;
  // Whether everything kept since the last change is whitespace.
  let bridge = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const start = at;
    at += token.length;
    const last = ranges[ranges.length - 1];
    if (keep[i]) {
      if (!/^\s+$/.test(token)) bridge = false;
      continue;
    }
    if (last && bridge) last[1] = at;
    else ranges.push([start, at]);
    bridge = true;
  }
  return ranges;
}

/**
 * The words that differ between a deleted line and the added line paired with it, or null when
 * the lines are equal, too long, or too different for word highlighting to help.
 */
export function wordRanges(oldText: string, newText: string): { old: Range[]; new: Range[] } | null {
  if (oldText === newText) return null;
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  // Longest common subsequence of tokens, by dynamic programming from the end.
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  let shared = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) {
      keepA[i] = 1;
      keepB[j] = 1;
      shared += (a[i] ?? "").trim().length;
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++;
    else j++;
  }

  const visible = Math.max(oldText.replace(/\s+/g, "").length, newText.replace(/\s+/g, "").length);
  if (visible > 0 && shared / visible < MIN_SHARED) return null;
  return { old: changedRanges(a, keepA), new: changedRanges(b, keepB) };
}

/**
 * Word ranges for every line of a hunk, indexed like `lines`. Each run of deletions is paired
 * line by line with the run of additions after it, as in the split view.
 */
export function intralineRanges(lines: DiffLine[]): Array<Range[] | undefined> {
  const out: Array<Range[] | undefined> = new Array<Range[] | undefined>(lines.length);
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== "Del") {
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (lines[i]?.kind === "Del") dels.push(i++);
    while (lines[i]?.kind === "Add") adds.push(i++);
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const d = dels[k] ?? 0;
      const a = adds[k] ?? 0;
      const ranges = wordRanges(lines[d]?.text ?? "", lines[a]?.text ?? "");
      if (!ranges) continue;
      out[d] = ranges.old;
      out[a] = ranges.new;
    }
  }
  return out;
}

/** A piece of a token, marked when it falls inside one of the ranges. */
export interface Piece {
  token: number;
  text: string;
  marked: boolean;
}

/** Cuts consecutive tokens (syntax tokens, or the whole line as one) at the range boundaries. */
export function markPieces(tokens: string[], ranges: Range[]): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  let r = 0;
  tokens.forEach((text, token) => {
    const end = at + text.length;
    let pos = at;
    while (pos < end) {
      while (r < ranges.length && (ranges[r]?.[1] ?? 0) <= pos) r++;
      const range = ranges[r];
      const inside = range !== undefined && range[0] <= pos;
      const stop = Math.min(end, range === undefined ? end : inside ? range[1] : range[0]);
      pieces.push({ token, text: text.slice(pos - at, stop - at), marked: inside });
      pos = stop;
    }
    at = end;
  });
  return pieces;
}
