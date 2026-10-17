import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../../components/Badge/Badge";
import type { CommitDetails, CommitSummary, FileChange } from "../../lib/bindings";
import type { CommandError } from "../../lib/errors";
import { describeError } from "../../lib/errors";
import { formatAgo, formatDateTime, shortHash, splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { GraphIndex } from "../graph/GraphIndex";
import { DiffView, type DiffMode } from "./DiffView";
import { FileList } from "./FileList";
import { useCommitDetails, useFileDiff } from "./useCommitDetails";
import type { UseQueryResult } from "@tanstack/react-query";
import styles from "./DetailsPanel.module.css";

interface DetailsPanelProps {
  sessionId: string;
  commit: CommitSummary | null;
  index: GraphIndex;
  onSelectCommit: (id: string) => void;
  /** Shows the commits that changed a file. */
  onFileHistory?: (path: string) => void;
}

export function DetailsPanel({ sessionId, commit, index, onSelectCommit, onFileHistory }: DetailsPanelProps) {
  // Holding j or k moves through commits fast; only ask the backend once it settles.
  const commitId = useDebouncedValue(commit?.id ?? null, 80);
  const m = useT();
  // A merge is compared with its first parent unless another one is picked.
  const [parentAt, setParentAt] = useState(0);
  useEffect(() => setParentAt(0), [commitId]);
  const base = parentAt > 0 && commit?.id === commitId ? (commit.parents[parentAt] ?? null) : null;
  const details = useCommitDetails(sessionId, commitId, base);
  const [copied, setCopied] = useState(false);

  if (!commit) {
    return <aside className={styles.panel}><p className={styles.empty}>{m.details.selectCommit}</p></aside>;
  }

  const data = details.data;
  const isMerge = commit.parents.length > 1;
  const refs = index.refs.get(commit.id) ?? [];

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(commit?.id ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be refused; there is nothing useful to do about it.
    }
  }

  return (
    <aside className={styles.panel} aria-label={m.details.label}>
      <header className={styles.head}>
        <div className={styles.kind}>{isMerge ? m.details.mergeCommit : commit.parents.length === 0 ? m.details.firstCommit : m.details.commit}</div>
        <h2 className={`${styles.title} selectable`}>{commit.summary}</h2>
        {data?.body && <pre className={`${styles.body} selectable`}>{data.body}</pre>}

        <div className={styles.author}>
          <span className={styles.avatar}>{commit.author.slice(0, 1).toUpperCase()}</span>
          <div>
            <div className={styles.who}>{commit.author}</div>
            <div className={styles.when}>
              {formatDateTime(commit.time ?? 0)} · {formatAgo(commit.time ?? 0, Date.now(), m)}
            </div>
          </div>
        </div>

        <dl className={styles.grid}>
          <dt>{m.details.commit}</dt>
          <dd>
            <code className="selectable">{shortHash(commit.id)}</code>
            <button type="button" className={styles.link} onClick={copyHash}>
              {copied ? m.details.copied : m.details.copy}
            </button>
          </dd>

          {commit.parents.length > 0 && (
            <>
              <dt>{m.details.parent}</dt>
              <dd className={styles.parents}>
                {commit.parents.map((id) => {
                  const at = index.indexOf(id);
                  const summary = at === null ? null : index.commits[at]?.summary;
                  return (
                    <button key={id} type="button" className={styles.chip} disabled={at === null} onClick={() => onSelectCommit(id)}>
                      <code>{shortHash(id)}</code>
                      <span>{summary ?? m.details.notLoaded}</span>
                    </button>
                  );
                })}
              </dd>
            </>
          )}

          {refs.length > 0 && (
            <>
              <dt>{m.details.ref}</dt>
              <dd className={styles.refs}>
                {refs.map((ref) => (
                  <Badge key={`${ref.kind}:${ref.name}`} color={ref.kind === "Tag" ? 3 : ref.kind === "Remote" ? 4 : 0}>
                    {ref.kind === "Head" ? `HEAD · ${ref.name}` : ref.name}
                  </Badge>
                ))}
              </dd>
            </>
          )}
        </dl>
        <p className={styles.tip}>{m.compare.hint}</p>
      </header>

      {details.isError && <p className={styles.error}>{describeError(details.error, m)}</p>}
      {details.isPending && commitId !== null && <p className={styles.empty}>{m.details.loading}</p>}

      <FileChanges
        sessionId={sessionId}
        commitId={commitId}
        base={base}
        details={details}
        onFileHistory={onFileHistory}
        hint={
          isMerge && (
            <div className={styles.hint}>
              <span className={styles.compared}>
                {m.details.comparedWith}
                <span className={styles.seg} role="tablist" aria-label={m.details.comparedWith}>
                  {commit.parents.map((id, n) => (
                    <button key={id} type="button" role="tab" aria-selected={parentAt === n} className={parentAt === n ? styles.on : undefined} title={shortHash(id)} onClick={() => setParentAt(n)}>
                      {m.details.parentOrdinal(n + 1)}
                    </button>
                  ))}
                </span>
              </span>
            </div>
          )
        }
      />
    </aside>
  );
}

interface FileChangesProps {
  sessionId: string;
  commitId: string | null;
  /** What the commit is compared with: null for its first parent. */
  base: string | null;
  details: UseQueryResult<CommitDetails, CommandError>;
  /** Shown under the heading, before the files. */
  hint?: ReactNode;
  onFileHistory?: (path: string) => void;
}

/** The changed files of a commit (against its parent or another commit) and the diff of one of them. */
export function FileChanges({ sessionId, commitId, base, details, hint, onFileHistory }: FileChangesProps) {
  const m = useT();
  const [picked, setPicked] = useState<FileChange | null>(null);
  const [mode, setMode] = useState<DiffMode>("unified");

  const files = details.data?.files;
  // The first file is shown until another is picked; picks do not carry over to other comparisons.
  const file = files?.find((f) => f.path === picked?.path) ?? files?.[0] ?? null;
  useEffect(() => setPicked(null), [commitId, base]);

  const diff = useFileDiff(sessionId, commitId, file, base);
  if (!files) return null;
  const additions = files.reduce((sum, f) => sum + (f.additions ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deletions ?? 0), 0);

  return (
    <>
      <section className={styles.section}>
        <h3>
          {m.details.changedFiles}<span className={styles.count}>{files.length}</span>
          <span className={styles.totals}>
            <i className={styles.add}>+{additions}</i>
            <i className={styles.del}>−{deletions}</i>
          </span>
        </h3>
        {hint}
        {details.data?.statsTruncated && <p className={styles.hint}>{m.details.statsTruncated}</p>}
        {files.length === 0 ? (
          <p className={styles.hint}>{m.details.noFiles}</p>
        ) : (
          <div className={styles.fileScroll}>
            <FileList files={files} selectedPath={file?.path ?? null} onSelect={setPicked} onHistory={onFileHistory} />
          </div>
        )}
      </section>

      {file && (
        <section className={`${styles.section} ${styles.diffSection}`}>
          <h3 className={styles.diffHead}>
            <span className={styles.diffName} title={file.path}>
              {splitPath(file.path)[1]}
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
    </>
  );
}
