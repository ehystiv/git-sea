import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";
import type { FileContent } from "../../lib/bindings";
import { formatBytes, formatCount, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { Code } from "../details/BlameView";
import { highlightLines } from "../details/highlight";
import styles from "./Files.module.css";

/** Lines rendered before the user asks for the rest, as in the diff and the blame. */
const INITIAL_LINES = 1500;
/** Longer files are shown without syntax colours, as in the blame. */
const MAX_HIGHLIGHT_LINES = 5000;

/** A file as it is in a commit, with line numbers and syntax colours. */
export function ContentView({ content }: { content: FileContent }) {
  const m = useT();
  const [showAll, setShowAll] = useState(false);
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    let active = true;
    setTokens(null);
    setShowAll(false);
    if (content.kind !== "Submodule" && content.kind !== "Symlink" && content.lines.length <= MAX_HIGHLIGHT_LINES) {
      void highlightLines(content.path, content.lines).then((result) => {
        if (active) setTokens(result);
      });
    }
    return () => {
      active = false;
    };
  }, [content]);

  if (content.kind === "Submodule") return <p className={styles.note}>{m.files.submodule(shortHash(content.lines[0] ?? ""))}</p>;
  if (content.kind === "Symlink") {
    return (
      <p className={styles.note}>
        {m.files.symlink} <code className="selectable">{content.lines[0] ?? ""}</code>
      </p>
    );
  }
  if (content.binary) return <p className={styles.note}>{m.files.binary(formatBytes(content.size ?? 0))}</p>;
  if (content.tooLarge) return <p className={styles.note}>{m.files.tooLarge(formatBytes(content.size ?? 0))}</p>;
  if (content.lines.length === 0) return <p className={styles.note}>{m.files.empty}</p>;

  const shown = showAll ? content.lines : content.lines.slice(0, INITIAL_LINES);
  return (
    <div className={`${styles.content} selectable`}>
      {shown.map((line, i) => (
        <div key={i} className={styles.line}>
          <span className={styles.no}>{i + 1}</span>
          <span className={styles.code}>
            <Code text={line} tokens={tokens?.[i]} />
          </span>
        </div>
      ))}
      {!showAll && content.lines.length > INITIAL_LINES && (
        <div className={styles.more}>
          <button type="button" onClick={() => setShowAll(true)}>
            {m.diff.showAll(formatCount(content.lines.length))}
          </button>
        </div>
      )}
    </div>
  );
}
