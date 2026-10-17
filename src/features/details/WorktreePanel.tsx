import { useState } from "react";
import type { FileChange } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { shortHash, splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { DiffView, type DiffMode } from "./DiffView";
import { FileList } from "./FileList";
import { useWorktreeDiff, useWorktreeStatus } from "./useWorktree";
import styles from "./DetailsPanel.module.css";

interface WorktreePanelProps {
  sessionId: string;
  onSelectCommit: (id: string) => void;
}

/** The local changes of the working copy, staged and not, with the diff of the picked file. */
export function WorktreePanel({ sessionId, onSelectCommit }: WorktreePanelProps) {
  const status = useWorktreeStatus(sessionId);
  const m = useT();
  const [picked, setPicked] = useState<{ path: string; staged: boolean } | null>(null);
  const [mode, setMode] = useState<DiffMode>("unified");

  const data = status.data;
  const staged = data?.staged ?? [];
  const unstaged = data?.unstaged ?? [];
  // The picked file until it has no changes left; else the first one, staged first.
  const pickedFile = picked && (picked.staged ? staged : unstaged).find((f) => f.path === picked.path);
  const current = pickedFile
    ? { file: pickedFile, staged: picked.staged }
    : staged[0]
      ? { file: staged[0], staged: true }
      : unstaged[0]
        ? { file: unstaged[0], staged: false }
        : null;
  const diff = useWorktreeDiff(sessionId, current?.file ?? null, current?.staged ?? false);

  return (
    <aside className={styles.panel} aria-label={m.worktree.title}>
      <header className={styles.head}>
        <div className={styles.kind}>{m.worktree.title}</div>
        <h2 className={styles.title}>
          {data ? m.worktree.files(data.files) : m.worktree.title}
        </h2>
        {data?.head && (
          <dl className={styles.grid}>
            <dt>{m.worktree.on}</dt>
            <dd>
              <button type="button" className={styles.chip} onClick={() => data.head && onSelectCommit(data.head)}>
                <code>{shortHash(data.head)}</code>
                <span>HEAD</span>
              </button>
            </dd>
          </dl>
        )}
      </header>

      {status.isError && <p className={styles.error}>{describeError(status.error, m)}</p>}
      {status.isPending && <p className={styles.empty}>{m.worktree.reading}</p>}
      {data && data.files === 0 && <p className={styles.empty}>{m.worktree.none}</p>}

      <FileSection
        title={m.worktree.staged}
        files={staged}
        selectedPath={current?.staged ? current.file.path : null}
        onSelect={(file) => setPicked({ path: file.path, staged: true })}
      />
      <FileSection
        title={m.worktree.unstaged}
        files={unstaged}
        selectedPath={current && !current.staged ? current.file.path : null}
        onSelect={(file) => setPicked({ path: file.path, staged: false })}
      />

      {current && (
        <section className={`${styles.section} ${styles.diffSection}`}>
          <h3 className={styles.diffHead}>
            <span className={styles.diffName} title={current.file.path}>
              {splitPath(current.file.path)[1]}
              <span className={styles.count}> · {current.staged ? m.worktree.stagedLower : m.worktree.unstagedLower}</span>
            </span>
            <span className={styles.seg} role="tablist" aria-label={m.details.diffMode}>
              {(["unified", "split"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={mode === d}
                  className={mode === d ? styles.on : undefined}
                  onClick={() => setMode(d)}
                >
                  {d === "unified" ? m.details.unified : m.details.split}
                </button>
              ))}
            </span>
          </h3>
          <div className={styles.diffScroll}>
            {diff.isError && <p className={styles.error}>{describeError(diff.error, m)}</p>}
            {diff.isPending && <p className={styles.empty}>{m.details.loadingDiff}</p>}
            {diff.data && <DiffView diff={diff.data} mode={mode} />}
          </div>
        </section>
      )}
    </aside>
  );
}

function FileSection({
  title,
  files,
  selectedPath,
  onSelect,
}: {
  title: string;
  files: FileChange[];
  selectedPath: string | null;
  onSelect: (file: FileChange) => void;
}) {
  if (files.length === 0) return null;
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);
  return (
    <section className={styles.section}>
      <h3>
        {title}
        <span className={styles.count}>{files.length}</span>
        <span className={styles.totals}>
          <i className={styles.add}>+{additions}</i>
          <i className={styles.del}>−{deletions}</i>
        </span>
      </h3>
      <div className={styles.fileScroll}>
        <FileList files={files} selectedPath={selectedPath} onSelect={onSelect} />
      </div>
    </section>
  );
}
