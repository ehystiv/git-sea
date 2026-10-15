import { useEffect, useState } from "react";
import { Badge } from "../../components/Badge/Badge";
import type { CommitSummary, FileChange } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { formatAgo, formatDateTime, shortHash, splitPath } from "../../lib/format";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { GraphIndex } from "../graph/GraphIndex";
import { DiffView, type DiffMode } from "./DiffView";
import { FileList } from "./FileList";
import { useCommitDetails, useFileDiff } from "./useCommitDetails";
import styles from "./DetailsPanel.module.css";

interface DetailsPanelProps {
  sessionId: string;
  commit: CommitSummary | null;
  index: GraphIndex;
  onSelectCommit: (id: string) => void;
}

export function DetailsPanel({ sessionId, commit, index, onSelectCommit }: DetailsPanelProps) {
  // Holding j or k moves through commits fast; only ask the backend once it settles.
  const commitId = useDebouncedValue(commit?.id ?? null, 80);
  const details = useCommitDetails(sessionId, commitId);

  const [picked, setPicked] = useState<FileChange | null>(null);
  const [mode, setMode] = useState<DiffMode>("unified");
  const [copied, setCopied] = useState(false);

  const files = details.data?.files;
  // The first file is shown until another is picked; picks do not carry over to other commits.
  const file = files?.find((f) => f.path === picked?.path) ?? files?.[0] ?? null;
  useEffect(() => setPicked(null), [commitId]);

  const diff = useFileDiff(sessionId, commitId, file);

  if (!commit) {
    return <aside className={styles.panel}><p className={styles.empty}>Seleziona un commit per vedere i dettagli.</p></aside>;
  }

  const data = details.data;
  const isMerge = commit.parents.length > 1;
  const refs = index.refs.get(commit.id) ?? [];
  const additions = files?.reduce((sum, f) => sum + (f.additions ?? 0), 0) ?? 0;
  const deletions = files?.reduce((sum, f) => sum + (f.deletions ?? 0), 0) ?? 0;

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
    <aside className={styles.panel} aria-label="Dettagli commit">
      <header className={styles.head}>
        <div className={styles.kind}>{isMerge ? "Merge commit" : commit.parents.length === 0 ? "Primo commit" : "Commit"}</div>
        <h2 className={`${styles.title} selectable`}>{commit.summary}</h2>
        {data?.body && <pre className={`${styles.body} selectable`}>{data.body}</pre>}

        <div className={styles.author}>
          <span className={styles.avatar}>{commit.author.slice(0, 1).toUpperCase()}</span>
          <div>
            <div className={styles.who}>{commit.author}</div>
            <div className={styles.when}>
              {formatDateTime(commit.time ?? 0)} · {formatAgo(commit.time ?? 0)}
            </div>
          </div>
        </div>

        <dl className={styles.grid}>
          <dt>Commit</dt>
          <dd>
            <code className="selectable">{shortHash(commit.id)}</code>
            <button type="button" className={styles.link} onClick={copyHash}>
              {copied ? "Copiato" : "Copia"}
            </button>
          </dd>

          {commit.parents.length > 0 && (
            <>
              <dt>Parent</dt>
              <dd className={styles.parents}>
                {commit.parents.map((id) => {
                  const at = index.indexOf(id);
                  const summary = at === null ? null : index.commits[at]?.summary;
                  return (
                    <button key={id} type="button" className={styles.chip} disabled={at === null} onClick={() => onSelectCommit(id)}>
                      <code>{shortHash(id)}</code>
                      <span>{summary ?? "non ancora caricato"}</span>
                    </button>
                  );
                })}
              </dd>
            </>
          )}

          {refs.length > 0 && (
            <>
              <dt>Ref</dt>
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
      </header>

      {details.isError && <p className={styles.error}>{describeError(details.error)}</p>}
      {details.isPending && commitId !== null && <p className={styles.empty}>Carico i dettagli…</p>}

      {files && (
        <section className={styles.section}>
          <h3>
            File modificati<span className={styles.count}>{files.length}</span>
            <span className={styles.totals}>
              <i className={styles.add}>+{additions}</i>
              <i className={styles.del}>−{deletions}</i>
            </span>
          </h3>
          {isMerge && <p className={styles.hint}>Differenze rispetto al primo parent.</p>}
          {data?.statsTruncated && <p className={styles.hint}>Righe aggiunte e tolte calcolate solo per i primi file.</p>}
          {files.length === 0 ? (
            <p className={styles.hint}>Nessun file cambiato.</p>
          ) : (
            <div className={styles.fileScroll}>
              <FileList files={files} selectedPath={file?.path ?? null} onSelect={setPicked} />
            </div>
          )}
        </section>
      )}

      {file && (
        <section className={`${styles.section} ${styles.diffSection}`}>
          <h3 className={styles.diffHead}>
            <span className={styles.diffName} title={file.path}>
              {splitPath(file.path)[1]}
            </span>
            <span className={styles.seg} role="tablist" aria-label="Modalità diff">
              {(["unified", "split"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={mode === m ? styles.on : undefined}
                  onClick={() => setMode(m)}
                >
                  {m === "unified" ? "Unificato" : "Affiancato"}
                </button>
              ))}
            </span>
          </h3>
          <div className={styles.diffScroll}>
            {diff.isError && <p className={styles.error}>{describeError(diff.error)}</p>}
            {diff.isPending && <p className={styles.empty}>Carico le differenze…</p>}
            {diff.data && <DiffView diff={diff.data} mode={mode} />}
          </div>
        </section>
      )}
    </aside>
  );
}
