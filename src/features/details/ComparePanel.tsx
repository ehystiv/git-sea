import type { CommitSummary } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { FileChanges } from "./DetailsPanel";
import { useCommitDetails, useMergeBase } from "./useCommitDetails";
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
  /** Only what `target` brings since it left `base`: compared with their common ancestor. */
  fromBase: boolean;
  onFromBase: (on: boolean) => void;
  /** A loaded commit, to name the common base. */
  lookup: (id: string) => CommitSummary | null;
}

/**
 * The differences between the trees of two commits, like `git diff base target`, or only what
 * `target` brings since the two sides parted, like `git diff base...target`.
 */
export function ComparePanel({ sessionId, base, target, counts, onSelectCommit, onSwap, onClose, onFileHistory, fromBase, onFromBase, lookup }: ComparePanelProps) {
  const m = useT();
  // When `base` is an ancestor of `target` it is the common base too: there is nothing to choose.
  const canChoose = counts === null || counts.onlyBase > 0;
  const threeDot = fromBase && canChoose;
  const mergeBase = useMergeBase(sessionId, threeDot ? base.id : null, threeDot ? target.id : null);
  // Unrelated histories have no common base: the trees are compared as they are.
  const diffBase = !threeDot ? base.id : mergeBase.isSuccess ? (mergeBase.data ?? base.id) : null;
  const details = useCommitDetails(sessionId, diffBase === null ? null : target.id, diffBase);
  const baseCommit = threeDot && mergeBase.data ? lookup(mergeBase.data) : null;
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
          {threeDot && mergeBase.data && (
            <>
              <dt>{m.compare.base}</dt>
              <dd>
                <button type="button" className={styles.chip} disabled={!baseCommit} onClick={() => mergeBase.data && onSelectCommit(mergeBase.data)}>
                  <code>{shortHash(mergeBase.data)}</code>
                  <span>{baseCommit?.summary ?? m.details.notLoaded}</span>
                </button>
              </dd>
            </>
          )}
        </dl>
        {canChoose && (
          <div className={styles.compareMode}>
            <span className={styles.seg} role="tablist" aria-label={m.compare.mode}>
              <button type="button" role="tab" aria-selected={!fromBase} className={!fromBase ? styles.on : undefined} title={m.compare.directTitle} onClick={() => onFromBase(false)}>
                {m.compare.direct}
              </button>
              <button type="button" role="tab" aria-selected={fromBase} className={fromBase ? styles.on : undefined} title={m.compare.fromBaseTitle} onClick={() => onFromBase(true)}>
                {m.compare.fromBase}
              </button>
            </span>
          </div>
        )}
        {threeDot && mergeBase.isPending && <p className={styles.compareCounts}>{m.compare.findingBase}</p>}
        {threeDot && mergeBase.isSuccess && mergeBase.data === null && <p className={styles.compareCounts}>{m.compare.noBase}</p>}
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

      {mergeBase.isError && <p className={styles.error}>{describeError(mergeBase.error, m)}</p>}
      {details.isError && <p className={styles.error}>{describeError(details.error, m)}</p>}
      {details.isPending && diffBase !== null && <p className={styles.empty}>{m.details.loading}</p>}
      {diffBase !== null && <FileChanges sessionId={sessionId} commitId={target.id} base={diffBase} details={details} onFileHistory={onFileHistory} onSelectCommit={onSelectCommit} />}
    </aside>
  );
}
