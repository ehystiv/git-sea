import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ThemedToken } from "shiki/core";
import type { FileBlame } from "../../lib/bindings";
import { formatAgo, formatCount, formatDateTime, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { blameRows } from "./blameModel";
import { highlightLines } from "./highlight";
import styles from "./BlameView.module.css";

/** Lines rendered before the user asks for the rest, as in the diff. */
const INITIAL_LINES = 1500;
/** Longer files are shown without syntax colours: tokenising them would hold up the panel. */
const MAX_HIGHLIGHT_LINES = 5000;

interface BlameViewProps {
  blame: FileBlame;
  /** The commit the file is shown at: its own lines are marked. */
  commitId: string;
  onSelectCommit: (id: string) => void;
}

export function BlameView({ blame, commitId, onSelectCommit }: BlameViewProps) {
  const m = useT();
  const [showAll, setShowAll] = useState(false);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const rows = useMemo(() => blameRows(blame), [blame]);
  const shown = showAll ? rows : rows.slice(0, INITIAL_LINES);

  useEffect(() => {
    let active = true;
    setTokens(null);
    setShowAll(false);
    if (blame.lines.length <= MAX_HIGHLIGHT_LINES) {
      void highlightLines(blame.path, blame.lines).then((result) => {
        if (active) setTokens(result);
      });
    }
    return () => {
      active = false;
    };
  }, [blame]);

  if (blame.binary) return <p className={styles.note}>{m.diff.binary}</p>;
  if (blame.tooLarge) return <p className={styles.note}>{m.blame.tooLarge}</p>;
  if (blame.lines.length === 0) return <p className={styles.note}>{m.blame.empty}</p>;

  const now = Date.now();
  return (
    <div className={`${styles.blame} selectable`}>
      {shown.map((row) => {
        const commit = row.commit;
        const own = commit?.id === commitId;
        const title = commit
          ? [
              `${shortHash(commit.id)} · ${commit.summary}`,
              `${commit.author} · ${formatDateTime(commit.time ?? 0)}`,
              row.sourcePath ? m.blame.renamedFrom(row.sourcePath) : null,
            ]
              .filter(Boolean)
              .join("\n")
          : undefined;
        return (
          <div
            key={row.line}
            className={`${styles.row} ${row.run % 2 ? styles.odd : ""} ${row.first ? styles.first : ""} ${own ? styles.own : ""}`}
            style={{ "--age": row.age } as CSSProperties}
          >
            {row.first && commit ? (
              <button type="button" className={styles.gutter} title={title} onClick={() => onSelectCommit(commit.id)}>
                <code>{shortHash(commit.id)}</code>
                <span className={styles.who}>{commit.author}</span>
                <span className={styles.ago}>{formatAgo(commit.time ?? 0, now, m)}</span>
              </button>
            ) : (
              <span className={styles.gutter} title={title} />
            )}
            <span className={styles.no}>{row.line + 1}</span>
            <span className={styles.code}>
              <Code text={blame.lines[row.line] ?? ""} tokens={tokens?.[row.line]} />
            </span>
          </div>
        );
      })}
      {!showAll && rows.length > INITIAL_LINES && (
        <div className={styles.more}>
          <button type="button" onClick={() => setShowAll(true)}>
            {m.diff.showAll(formatCount(rows.length))}
          </button>
        </div>
      )}
    </div>
  );
}

function Code({ text, tokens }: { text: string; tokens?: ThemedToken[] }) {
  if (text === "" || tokens?.length === 0) return <> </>;
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span
          key={i}
          style={{
            color: token.color,
            fontStyle: (token.fontStyle ?? 0) & 1 ? "italic" : undefined,
            fontWeight: (token.fontStyle ?? 0) & 2 ? 600 : undefined,
          }}
        >
          {token.content}
        </span>
      ))}
    </>
  );
}
