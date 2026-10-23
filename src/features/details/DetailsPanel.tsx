import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../../components/Badge/Badge";
import type { CommitDetails, CommitSummary, FileChange, PullRequestsReport, RefLabel } from "../../lib/bindings";
import { openUrl } from "../ci/useCi";
import { pullLabel, pullsOfCommit } from "../pulls/pulls";
import type { CommandError } from "../../lib/errors";
import { describeError } from "../../lib/errors";
import { formatAgo, formatDateTime, shortHash, splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { containingRefs } from "../graph/contains";
import type { GraphIndex } from "../graph/GraphIndex";
import { BlameView } from "./BlameView";
import { DiffView, type DiffMode } from "./DiffView";
import { FileList } from "./FileList";
import { useBlame, useCommitDetails, useFileDiff } from "./useCommitDetails";
import type { UseQueryResult } from "@tanstack/react-query";
import styles from "./DetailsPanel.module.css";

interface DetailsPanelProps {
  sessionId: string;
  commit: CommitSummary | null;
  index: GraphIndex;
  /** Bumped when `index` changes. */
  version: number;
  /** Pull or merge requests of the remote's project, to name the ones of the commit. */
  pulls?: PullRequestsReport | null;
  onSelectCommit: (id: string) => void;
  /** Shows the commits that changed a file. */
  onFileHistory?: (path: string) => void;
}

/** Branches shown before "and N more". */
const BRANCHES_SHOWN = 6;

export function DetailsPanel({ sessionId, commit, index, version, pulls = null, onSelectCommit, onFileHistory }: DetailsPanelProps) {
  // Holding j or k moves through commits fast; only ask the backend once it settles.
  const commitId = useDebouncedValue(commit?.id ?? null, 80);
  const m = useT();
  // A merge is compared with its first parent unless another one is picked.
  const [parentAt, setParentAt] = useState(0);
  useEffect(() => setParentAt(0), [commitId]);
  const base = parentAt > 0 && commit?.id === commitId ? (commit.parents[parentAt] ?? null) : null;
  const details = useCommitDetails(sessionId, commitId, base);
  const [copied, setCopied] = useState(false);
  const [allBranches, setAllBranches] = useState(false);
  useEffect(() => setAllBranches(false), [commitId]);

  // The branches and tags that hold the commit, once the selection settles.
  const containment = useMemo(() => {
    if (commitId === null) return null;
    const at = index.indexOf(commitId);
    if (at === null || index.commits[at]?.id !== commitId) return null;
    const hasTags = [...index.refs.values()].some((list) => list.some((ref) => ref.kind === "Tag"));
    return { ...containingRefs(index, at), hasTags };
    // `version` stands for the contents of `index`, which is mutated in place.
  }, [index, version, commitId]);

  if (!commit) {
    return <aside className={styles.panel}><p className={styles.empty}>{m.details.selectCommit}</p></aside>;
  }

  const data = details.data;
  const isMerge = commit.parents.length > 1;
  const refs = index.refs.get(commit.id) ?? [];
  const requests = pullsOfCommit(pulls, commit.id);
  // The names come with the commit; the emails, for the tooltip, with its details.
  const coAuthors = data && data.id === commit.id ? data.coAuthors.map((p) => ({ name: p.name, title: `${p.name} <${p.email}>` })) : (commit.coAuthors ?? []).map((name) => ({ name, title: name }));

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
            {coAuthors.length > 0 && (
              <div className={styles.coAuthors} title={`${m.details.coAuthorsTitle}\n${coAuthors.map((p) => p.title).join("\n")}`}>
                {m.details.withCoAuthors(coAuthors.map((p) => p.name).join(", "))}
              </div>
            )}
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

          {requests.length > 0 && (
            <>
              <dt>{m.pulls.label}</dt>
              <dd className={styles.parents}>
                {requests.map((pull) => {
                  const label = pullLabel(pulls?.provider ?? null, pull.number);
                  const url = pull.url;
                  return (
                    <button
                      key={pull.number}
                      type="button"
                      className={styles.chip}
                      disabled={!url}
                      title={url ? m.pulls.open(label) : undefined}
                      onClick={() => url && openUrl(url)}
                    >
                      <code>{label}</code>
                      <span>{pull.title}</span>
                      <i className={`${styles.pullState} ${styles[pull.state] ?? ""}`}>{m.pulls.states[pull.state]}</i>
                    </button>
                  );
                })}
              </dd>
            </>
          )}

          {containment?.hasTags && (
            <>
              <dt>{m.contains.release}</dt>
              <dd className={styles.refs}>
                {containment.firstTag ? (
                  <>
                    <RefButton label={containment.firstTag} title={m.contains.firstTag} onSelect={onSelectCommit} />
                    {containment.tags.length > 1 && <span className={styles.muted}>{m.contains.moreTags(containment.tags.length - 1)}</span>}
                  </>
                ) : (
                  <span className={styles.muted}>{m.contains.noTag}</span>
                )}
              </dd>
            </>
          )}

          {containment && (
            <>
              <dt>{m.contains.in}</dt>
              <dd className={styles.refs}>
                {containment.branches.length + containment.remotes.length === 0 ? (
                  <span className={styles.muted}>{m.contains.noBranch}</span>
                ) : (
                  (() => {
                    const all = [...containment.branches, ...containment.remotes];
                    const shown = allBranches ? all : all.slice(0, BRANCHES_SHOWN);
                    return (
                      <>
                        {shown.map((ref) => (
                          <RefButton key={`${ref.kind}:${ref.name}`} label={ref} title={m.contains.goTo(ref.name)} onSelect={onSelectCommit} />
                        ))}
                        {all.length > shown.length && (
                          <button type="button" className={styles.link} onClick={() => setAllBranches(true)}>
                            {m.contains.more(all.length - shown.length)}
                          </button>
                        )}
                      </>
                    );
                  })()
                )}
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
        onSelectCommit={onSelectCommit}
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

/** A branch or tag that selects the commit it points to. */
function RefButton({ label, title, onSelect }: { label: RefLabel; title: string; onSelect: (id: string) => void }) {
  return (
    <button type="button" className={styles.refButton} title={title} onClick={() => onSelect(label.commit)}>
      <Badge color={label.kind === "Tag" ? 3 : label.kind === "Remote" ? 4 : 0}>{label.name}</Badge>
    </button>
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
  /** Picks a commit named by the blame. */
  onSelectCommit: (id: string) => void;
}

/** How the picked file is shown: its differences, or who last changed each line. */
type FileView = DiffMode | "blame";
const FILE_VIEWS: readonly FileView[] = ["unified", "split", "blame"];

/** The changed files of a commit (against its parent or another commit) and the diff of one of them. */
export function FileChanges({ sessionId, commitId, base, details, hint, onFileHistory, onSelectCommit }: FileChangesProps) {
  const m = useT();
  const [picked, setPicked] = useState<FileChange | null>(null);
  const [view, setView] = useState<FileView>("unified");

  const files = details.data?.files;
  // The first file is shown until another is picked; picks do not carry over to other comparisons.
  const file = files?.find((f) => f.path === picked?.path) ?? files?.[0] ?? null;
  useEffect(() => setPicked(null), [commitId, base]);

  // A deleted file has nothing left to blame; its diff is shown instead.
  const canBlame = file !== null && file.status !== "Deleted";
  const blaming = view === "blame" && canBlame;
  const diff = useFileDiff(sessionId, commitId, blaming ? null : file, base);
  const blame = useBlame(sessionId, blaming ? commitId : null, blaming ? (file?.path ?? null) : null);
  const mode: DiffMode = view === "split" ? "split" : "unified";
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
              {FILE_VIEWS.map((d) => {
                const on = d === "blame" ? blaming : view === d || (d === "unified" && view === "blame" && !canBlame);
                return (
                  <button
                    key={d}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={on ? styles.on : undefined}
                    disabled={d === "blame" && !canBlame}
                    title={d === "blame" ? (canBlame ? m.blame.title : m.blame.deleted) : undefined}
                    onClick={() => setView(d)}
                  >
                    {d === "unified" ? m.details.unified : d === "split" ? m.details.split : m.blame.tab}
                  </button>
                );
              })}
            </span>
          </h3>
          <div className={styles.diffScroll}>
            {blaming ? (
              <>
                {blame.isError && <p className={styles.error}>{describeError(blame.error, m)}</p>}
                {blame.isPending && <p className={styles.empty}>{m.blame.loading}</p>}
                {blame.data && commitId !== null && <BlameView blame={blame.data} commitId={commitId} onSelectCommit={onSelectCommit} />}
              </>
            ) : (
              <>
                {diff.isError && <p className={styles.error}>{describeError(diff.error, m)}</p>}
                {diff.isPending && <p className={styles.empty}>{m.details.loadingDiff}</p>}
                {diff.data && <DiffView diff={diff.data} mode={mode} />}
              </>
            )}
          </div>
        </section>
      )}
    </>
  );
}
