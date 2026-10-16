import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compressIndex } from "./compress";
import { GraphIndex, type ReplaceMotion } from "./GraphIndex";

export interface CompressedIndex {
  /** The compressed projection; a stable object whose contents are swapped as the history changes. */
  index: GraphIndex;
  /** Changes whenever `index` got new contents. */
  version: number;
  /** How many runs are currently open. */
  expandedCount: number;
  expand: (id: string) => void;
  /** Closes one run again, named by its newest commit. */
  collapse: (id: string) => void;
  collapseAll: () => void;
}

/**
 * Keeps a compressed projection of `base` up to date while `enabled`. The projection is one
 * long-lived GraphIndex, so the canvas keeps its place when it is rebuilt (new chunks, a run
 * opened) instead of starting over.
 */
export function useCompressedIndex(base: GraphIndex, baseVersion: number, enabled: boolean): CompressedIndex {
  const index = useMemo(() => new GraphIndex(), [base]);
  const [version, setVersion] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Opening or closing a run animates, and so do the new commits a reload brings; new chunks of
  // the first load and switching views do not.
  const shownExpanded = useRef<ReadonlySet<string> | null>(null);
  // A reload swaps the base's arrays for fresh ones, while chunks are appended to the same ones.
  const shownCommits = useRef<unknown[] | null>(null);
  useEffect(() => {
    if (!enabled) {
      shownExpanded.current = null;
      shownCommits.current = null;
      return;
    }
    let motion: ReplaceMotion = "none";
    if (shownExpanded.current !== null) {
      if (shownExpanded.current !== expanded) motion = "run";
      else if (shownCommits.current !== base.commits) motion = "arrival";
    }
    shownExpanded.current = expanded;
    shownCommits.current = base.commits;
    index.replaceWith(compressIndex(base, expanded), motion);
    setVersion((v) => v + 1);
  }, [base, baseVersion, enabled, expanded, index]);

  const expand = useCallback((id: string) => setExpanded((prev) => new Set(prev).add(id)), []);
  const collapse = useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  return { index, version, expandedCount: expanded.size, expand, collapse, collapseAll };
}
