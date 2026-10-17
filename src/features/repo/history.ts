/** The commits the selection went through, for ⌘[ and ⌘], like a browser's back and forward. */
export interface SelectionHistory {
  entries: string[];
  /** Position of the current entry, or -1 when empty. */
  at: number;
}

export const emptyHistory: SelectionHistory = { entries: [], at: -1 };

/** Entries kept; the oldest go first. */
export const MAX_HISTORY = 100;

/**
 * Records a new selection. Forward entries are dropped, as in a browser. A step (`isStep`, such
 * as moving with j/k) replaces the current entry instead, so walking commit by commit leaves one
 * entry and back returns to where the walk started.
 */
export function visit(history: SelectionHistory, id: string, isStep: (from: string, to: string) => boolean): SelectionHistory {
  const current = history.entries[history.at];
  if (current === id) return history;
  const kept = history.entries.slice(0, history.at + 1);
  if (current !== undefined && isStep(current, id)) {
    // Replacing must not make two equal entries in a row.
    if (kept[kept.length - 2] === id) kept.pop();
    else kept[kept.length - 1] = id;
  } else kept.push(id);
  const entries = kept.slice(-MAX_HISTORY);
  return { entries, at: entries.length - 1 };
}

/** One step back (-1) or forward (1), skipping entries `exists` rejects; null when there is nowhere to go. */
export function go(history: SelectionHistory, step: -1 | 1, exists: (id: string) => boolean = () => true): SelectionHistory | null {
  for (let at = history.at + step; at >= 0 && at < history.entries.length; at += step) {
    const id = history.entries[at];
    if (id !== undefined && exists(id)) return { ...history, at };
  }
  return null;
}
