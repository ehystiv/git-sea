import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CommitSummary, EntryKind } from "../../lib/bindings";
import { describeError } from "../../lib/errors";
import { formatCount, shortHash, splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { BlameView } from "../details/BlameView";
import { useBlame } from "../details/useCommitDetails";
import { ContentView } from "./ContentView";
import { buildTree, filterFiles, markedPieces, parentDirs, treeRows, type TreeNode } from "./tree";
import { useFileContent, useTreeFiles } from "./useFiles";
import panel from "../details/DetailsPanel.module.css";
import styles from "./Files.module.css";

/** Matches listed for a search; the rest are counted. */
const MAX_MATCHES = 200;
const ROW_HEIGHT = 24;

interface FilesPanelProps {
  sessionId: string;
  /** The commit whose tree is shown; the panel follows the selection. */
  commit: CommitSummary | null;
  /** The file shown when the panel opens. */
  initialPath: string | null;
  onSelectCommit: (id: string) => void;
  onFileHistory: (path: string) => void;
  onClose: () => void;
}

type FileView = "content" | "blame";

/** Every file of a commit, as a tree or found by name, and the content or blame of one of them. */
export function FilesPanel({ sessionId, commit, initialPath, onSelectCommit, onFileHistory, onClose }: FilesPanelProps) {
  const m = useT();
  const commitId = commit?.id ?? null;
  const files = useTreeFiles(sessionId, commitId);
  const [path, setPath] = useState<string | null>(initialPath);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialPath ? parentDirs(initialPath) : []));
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [view, setView] = useState<FileView>("content");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** A file to scroll to once the rows include it. */
  const [reveal, setReveal] = useState<string | null>(initialPath);

  useEffect(() => inputRef.current?.focus(), []);

  const list = files.data ?? null;
  const root = useMemo(() => (list ? buildTree(list) : null), [list]);
  const searching = query.trim() !== "";
  const matches = useMemo(() => (list && searching ? filterFiles(list, query, Infinity) : []), [list, query, searching]);
  const rows = useMemo(() => (root && !searching ? treeRows(root, expanded) : []), [root, expanded, searching]);
  const count = searching ? Math.min(matches.length, MAX_MATCHES) : rows.length;
  useEffect(() => setActive(0), [query]);

  const virtualizer = useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 12 });

  useEffect(() => {
    if (reveal === null || searching) return;
    const at = rows.findIndex((row) => row.node.path === reveal);
    if (at < 0) return;
    virtualizer.scrollToIndex(at, { align: "center" });
    setReveal(null);
  }, [reveal, rows, searching, virtualizer]);

  const exists = path !== null && list !== null && list.some((f) => f.path === path);
  const kind: EntryKind | null = exists ? (list?.find((f) => f.path === path)?.kind ?? null) : null;
  const canBlame = kind === "File" || kind === "Executable";
  const blaming = view === "blame" && canBlame;
  const content = useFileContent(sessionId, exists && !blaming ? commitId : null, path);
  const blame = useBlame(sessionId, exists && blaming ? commitId : null, blaming ? path : null);

  const pick = (picked: string) => {
    setPath(picked);
    setExpanded((open) => new Set([...open, ...parentDirs(picked)]));
    setQuery("");
    setReveal(picked);
  };
  const toggle = (dir: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!searching) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, Math.min(count - 1, active + (event.key === "ArrowDown" ? 1 : -1)));
      setActive(next);
      virtualizer.scrollToIndex(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = matches[active];
      if (match) pick(match.file.path);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  }

  const name = path === null ? null : splitPath(path)[1];
  return (
    <aside className={panel.panel} aria-label={m.files.label}>
      <header className={panel.head}>
        <div className={panel.compareTop}>
          <div className={panel.kind}>{m.files.title}</div>
          <span className={panel.compareActions}>
            <button type="button" className={panel.link} onClick={onClose} aria-label={m.files.close} title={m.files.close}>
              ×
            </button>
          </span>
        </div>
        {commit && (
          <dl className={panel.grid}>
            <dt>{m.details.commit}</dt>
            <dd>
              <button type="button" className={panel.chip} onClick={() => onSelectCommit(commit.id)}>
                <code>{shortHash(commit.id)}</code>
                <span>{commit.summary}</span>
              </button>
            </dd>
          </dl>
        )}
      </header>

      <section className={panel.section}>
        <h3>
          {m.files.title}
          {list && <span className={panel.count}>{formatCount(list.length)}</span>}
        </h3>
        <div className={styles.filter}>
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder={m.files.filterPlaceholder}
            aria-label={m.files.filter}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {files.isError && <p className={panel.error}>{describeError(files.error, m)}</p>}
        {files.isPending && <p className={panel.hint}>{m.files.loading}</p>}
        {searching && list && matches.length === 0 && <p className={panel.hint}>{m.files.noMatch}</p>}
        <div ref={scrollRef} className={styles.tree} role="tree" aria-label={m.files.title} hidden={count === 0}>
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const style = { height: ROW_HEIGHT, transform: `translateY(${item.start}px)` };
              if (searching) {
                const match = matches[item.index];
                if (!match) return null;
                const [dir, base] = splitPath(match.file.path);
                const nameStart = match.file.path.length - base.length;
                return (
                  <button
                    key={match.file.path}
                    type="button"
                    role="treeitem"
                    className={`${styles.row} ${item.index === active ? styles.active : ""}`}
                    style={style}
                    title={match.file.path}
                    onClick={() => pick(match.file.path)}
                  >
                    <FileIcon kind={match.file.kind} />
                    <span className={styles.name}>
                      <Marked text={base} marks={match.marks.filter((i) => i >= nameStart).map((i) => i - nameStart)} />
                    </span>
                    {dir && (
                      <span className={styles.dir}>
                        <Marked text={dir} marks={match.marks.filter((i) => i < dir.length)} />
                      </span>
                    )}
                  </button>
                );
              }
              const row = rows[item.index];
              if (!row) return null;
              const node = row.node;
              const isDir = node.kind === "Dir";
              return (
                <button
                  key={node.path}
                  type="button"
                  role="treeitem"
                  aria-expanded={isDir ? row.open : undefined}
                  aria-selected={!isDir && node.path === path}
                  className={`${styles.row} ${!isDir && node.path === path ? styles.selected : ""}`}
                  style={{ ...style, paddingLeft: 8 + row.depth * 14 }}
                  title={node.path}
                  onClick={() => (isDir ? toggle(node.path) : setPath(node.path))}
                >
                  {isDir ? <Chevron open={row.open} /> : <FileIcon kind={node.kind} />}
                  <span className={`${styles.name} ${isDir ? styles.dirName : ""}`}>{node.name}</span>
                  {node.kind !== "Dir" && node.kind !== "File" && <span className={styles.kind}>{m.files.kinds[node.kind]}</span>}
                </button>
              );
            })}
          </div>
        </div>
        {searching && matches.length > MAX_MATCHES && <p className={panel.hint}>{m.files.more(formatCount(matches.length - MAX_MATCHES))}</p>}
      </section>

      <section className={`${panel.section} ${panel.diffSection}`}>
        {path === null || name === null ? (
          <p className={panel.empty}>{m.files.pick}</p>
        ) : (
          <>
            <h3 className={panel.diffHead}>
              <span className={panel.diffName} title={path}>
                {name}
              </span>
              <span className={styles.actions}>
                <span className={panel.seg} role="tablist" aria-label={m.details.diffMode}>
                  <button type="button" role="tab" aria-selected={!blaming} className={!blaming ? panel.on : undefined} title={m.files.contentTitle} onClick={() => setView("content")}>
                    {m.files.content}
                  </button>
                  <button type="button" role="tab" aria-selected={blaming} className={blaming ? panel.on : undefined} disabled={!canBlame} title={m.blame.title} onClick={() => setView("blame")}>
                    {m.blame.tab}
                  </button>
                </span>
                <button type="button" className={styles.history} aria-label={m.details.fileHistory(name)} title={m.details.fileHistory(name)} onClick={() => onFileHistory(path)}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5M12 7v5l3 2" />
                  </svg>
                </button>
              </span>
            </h3>
            <div className={panel.diffScroll}>
              {list !== null && !exists ? (
                <p className={panel.empty}>{m.files.missing}</p>
              ) : blaming ? (
                <>
                  {blame.isError && <p className={panel.error}>{describeError(blame.error, m)}</p>}
                  {blame.isPending && <p className={panel.empty}>{m.blame.loading}</p>}
                  {blame.data && commitId !== null && <BlameView blame={blame.data} commitId={commitId} onSelectCommit={onSelectCommit} />}
                </>
              ) : (
                <>
                  {content.isError && <p className={panel.error}>{describeError(content.error, m)}</p>}
                  {content.isPending && exists && <p className={panel.empty}>{m.files.reading}</p>}
                  {content.data && <ContentView content={content.data} />}
                </>
              )}
            </div>
          </>
        )}
      </section>
    </aside>
  );
}

function Marked({ text, marks }: { text: string; marks: number[] }) {
  return (
    <>
      {markedPieces(text, marks).map((piece, i) =>
        piece.marked ? (
          <mark key={i} className={styles.mark}>
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`${styles.icon} ${open ? styles.open : ""}`} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function FileIcon({ kind }: { kind: TreeNode["kind"] }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "Submodule" ? (
        <path d="M12 3 3 8l9 5 9-5-9-5zM3 16l9 5 9-5" />
      ) : kind === "Symlink" ? (
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
      ) : (
        <>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </>
      )}
    </svg>
  );
}
