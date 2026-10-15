import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummary } from "../../lib/bindings";
import { formatRelative, shortHash } from "../../lib/format";
import styles from "./CommitList.module.css";

const ROW_HEIGHT = 32;

interface CommitListProps {
  commits: CommitSummary[];
  selectedId: string | null;
  onSelect: (commit: CommitSummary) => void;
}

export function CommitList({ commits, selectedId, onSelect }: CommitListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div className={styles.list}>
      <div className={`${styles.columns} ${styles.header}`}>
        <span>Messaggio</span>
        <span>Autore</span>
        <span>Data</span>
        <span>Hash</span>
      </div>

      <div ref={scrollRef} className={styles.scroller}>
        <div className={styles.canvas} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const commit = commits[item.index];
            if (!commit) return null;
            return (
              <div
                key={commit.id}
                className={`${styles.columns} ${styles.row} ${commit.id === selectedId ? styles.selected : ""}`}
                onClick={() => onSelect(commit)}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span className={styles.summary}>{commit.summary}</span>
                <span className={styles.author}>{commit.author}</span>
                <span className={styles.date}>{formatRelative(commit.time ?? 0, now)}</span>
                <span className={styles.hash}>{shortHash(commit.id)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
