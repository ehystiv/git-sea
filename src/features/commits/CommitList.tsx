import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { describeCommit } from "../graph/describe";
import { authorsOf } from "./authors";
import type { CommitSummary } from "../../lib/bindings";
import { formatRelative, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import styles from "./CommitList.module.css";

const ROW_HEIGHT = 32;

interface CommitListProps {
  commits: CommitSummary[];
  selectedId: string | null;
  onSelect: (commit: CommitSummary) => void;
  /** ⇧-click on another commit than the selected one. */
  onCompare?: (commit: CommitSummary) => void;
  /** Right-click on a commit, at window coordinates. */
  onContextMenu?: (commit: CommitSummary, x: number, y: number) => void;
}

export function CommitList({ commits, selectedId, onSelect, onCompare, onContextMenu }: CommitListProps) {
  const m = useT();
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
        <span>{m.list.message}</span>
        <span>{m.list.author}</span>
        <span>{m.list.date}</span>
        <span>{m.list.hash}</span>
      </div>

      <div ref={scrollRef} className={styles.scroller}>
        <div className={styles.canvas} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const commit = commits[item.index];
            if (!commit) return null;
            const people = authorsOf(commit);
            const described = describeCommit(commit.summary, commit.parents.length);
            return (
              <div
                key={commit.id}
                className={`${styles.columns} ${styles.row} ${commit.id === selectedId ? styles.selected : ""}`}
                onContextMenu={(event) => {
                  if (!onContextMenu) return;
                  event.preventDefault();
                  onContextMenu(commit, event.clientX, event.clientY);
                }}
                onClick={(event) => {
                  if (event.shiftKey && onCompare && selectedId !== null && commit.id !== selectedId) onCompare(commit);
                  else onSelect(commit);
                }}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span className={styles.summary} title={commit.summary}>
                  {described.prefix ? (
                    <>
                      <span className={`${styles.type} ${styles[described.kind] ?? ""}`}>{described.prefix}</span>
                      {described.emoji ? `${described.emoji} ` : ""}
                      {described.label}
                    </>
                  ) : (
                    commit.summary
                  )}
                </span>
                <span className={styles.author} title={people.join(", ")}>
                  {commit.author}
                  {people.length > 1 && <span className={styles.more}> +{people.length - 1}</span>}
                </span>
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
