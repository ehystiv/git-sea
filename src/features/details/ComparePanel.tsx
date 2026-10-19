import type { CommitSummary } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { FileChanges } from "./DetailsPanel";
import { useCommitDetails } from "./useCommitDetails";
import styles from "./DetailsPanel.module.css";

interface ComparePanelProps {
  sessionId: string;
  /** The older side: what `target` is compared with. */
  base: CommitSummary;
  target: CommitSummary;
  /** Commits reachable from one side only; null while the history is not loaded far enough. */
  counts: { onlyBase: number; onlyTarget: number } | null;
  onSelectCommit: (id: string) => void;
  onSwap: () => void;
  onClose: () => void;
  onFileHistory?: (path: string) => void;
}

/** The differences between the trees of two commits, like `git diff base target`. */
export function ComparePanel({ sessionId, base, target, counts, onSelectCommit, onSwap, onClose, onFileHistory }: ComparePanelProps) {
  const m = useT();
  const details = useCommitDetails(sessionId, target.id, base.id);
  const side = (label: string, commit: CommitSummary) => (
    <>
      <dt>{label}</dt>
      <dd>
        <button type="button" className={styles.chip} onClick={() => onSelectCommit(commit.id)}>
          <code>{shortHash(commit.id)}</code>
          <span>{commit.summary}</span>
        </button>
      </dd>
    </>
  );

  return (
    <aside className={styles.panel} aria-label={m.compare.label}>
      <header className={styles.head}>
        <div className={styles.compareTop}>
          <div className={styles.kind}>{m.compare.title}</div>
          <span className={styles.compareActions}>
            <button type="button" className={styles.link} onClick={onSwap}>
              {m.compare.swap}
            </button>
            <button type="button" className={styles.link} onClick={onClose} aria-label={m.compare.close} title={m.compare.close}>
              ×
            </button>
          </span>
        </div>
        <dl className={styles.grid}>
          {side(m.compare.from, base)}
          {side(m.compare.to, target)}
        </dl>
        {counts && (
          <p className={styles.compareCounts}>
            {counts.onlyBase === 0 && counts.onlyTarget === 0 ? (
              m.compare.sameHistory
            ) : (
              <>
                {counts.onlyTarget > 0 && <span>{m.compare.onlyIn(counts.onlyTarget, m.compare.to)}</span>}
                {counts.onlyBase > 0 && <span>{m.compare.onlyIn(counts.onlyBase, m.compare.from)}</span>}
              </>
            )}
          </p>
        )}
      </header>

      {details.isError && <p className={styles.error}>{describeError(details.error, m)}</p>}
      {details.isPending && <p className={styles.empty}>{m.details.loading}</p>}
      <FileChanges sessionId={sessionId} commitId={target.id} base={base.id} details={details} onFileHistory={onFileHistory} onSelectCommit={onSelectCommit} />
    </aside>
  );
}
