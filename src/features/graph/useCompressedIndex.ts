import { useCallback, useEffect, useMemo, useState } from "react";
import { compressIndex } from "./compress";
import { GraphIndex } from "./GraphIndex";

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

  useEffect(() => {
    if (!enabled) return;
    index.replaceWith(compressIndex(base, expanded));
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
