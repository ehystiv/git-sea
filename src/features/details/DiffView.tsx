import { useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki/core";
import type { DiffLine, FileDiff } from "../../lib/bindings";
import { hunkHeader, limitHunks, splitRows, totalLines } from "./diffModel";
import { highlightHunks, type HunkTokens } from "./highlight";
import styles from "./DiffView.module.css";

export type DiffMode = "unified" | "split";

/** Lines rendered before the user asks for the rest; keeps huge diffs responsive. */
const INITIAL_LINES = 1500;

function Code({ text, tokens }: { text: string; tokens?: ThemedToken[] }) {
  if (!tokens) return <>{text || " "}</>;
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
      {tokens.length === 0 && " "}
    </>
  );
}

const SIGN: Record<DiffLine["kind"], string> = { Context: " ", Add: "+", Del: "−" };

export function DiffView({ diff, mode }: { diff: FileDiff; mode: DiffMode }) {
  const [showAll, setShowAll] = useState(false);
  const [tokens, setTokens] = useState<HunkTokens | null>(null);

  const total = totalLines(diff.hunks);
  const hunks = useMemo(
    () => (showAll ? diff.hunks : limitHunks(diff.hunks, INITIAL_LINES)),
    [diff.hunks, showAll],
  );

  useEffect(() => {
    let active = true;
    setTokens(null);
    setShowAll(false);
    void highlightHunks(diff.path, diff.hunks).then((result) => {
      if (active) setTokens(result);
    });
    return () => {
      active = false;
    };
  }, [diff]);

  if (diff.binary) return <p className={styles.note}>File binario: nessuna anteprima.</p>;
  if (diff.tooLarge) return <p className={styles.note}>File troppo grande per mostrare le differenze.</p>;
  if (diff.hunks.length === 0) return <p className={styles.note}>Nessuna differenza nel contenuto.</p>;

  return (
    <div className={`${styles.diff} selectable`}>
      {hunks.map((hunk, h) => (
        <section key={h} className={styles.hunk}>
          <div className={styles.hunkHeader}>{hunkHeader(hunk)}</div>
          {mode === "unified"
            ? hunk.lines.map((line, i) => (
                <div key={i} className={`${styles.row} ${styles[line.kind]}`}>
                  <span className={styles.no}>{line.oldNo ?? ""}</span>
                  <span className={styles.no}>{line.newNo ?? ""}</span>
                  <span className={styles.code}>
                    <b className={styles.sign}>{SIGN[line.kind]}</b>
                    <Code text={line.text} tokens={tokens?.[h]?.[i]} />
                  </span>
                </div>
              ))
            : splitRows(hunk).map((row, i) => (
                <div key={i} className={styles.splitRow}>
                  <SplitSide line={row.left} tokens={row.leftAt === null ? undefined : tokens?.[h]?.[row.leftAt]} side="old" />
                  <SplitSide line={row.right} tokens={row.rightAt === null ? undefined : tokens?.[h]?.[row.rightAt]} side="new" />
                </div>
              ))}
        </section>
      ))}

      {(diff.truncated || (!showAll && total > INITIAL_LINES)) && (
        <div className={styles.more}>
          {!showAll && total > INITIAL_LINES ? (
            <button type="button" onClick={() => setShowAll(true)}>
              Mostra tutte le {total.toLocaleString("it-IT")} righe
            </button>
          ) : (
            <span>Differenze troncate: file molto lungo.</span>
          )}
        </div>
      )}
    </div>
  );
}

function SplitSide({ line, tokens, side }: { line: DiffLine | null; tokens?: ThemedToken[]; side: "old" | "new" }) {
  if (!line) return <div className={`${styles.half} ${styles.empty}`} />;
  const kind = line.kind === "Context" ? "Context" : side === "old" ? "Del" : "Add";
  return (
    <div className={`${styles.half} ${styles[kind]}`}>
      <span className={styles.no}>{(side === "old" ? line.oldNo : line.newNo) ?? ""}</span>
      <span className={styles.code}>
        <Code text={line.text} tokens={tokens} />
      </span>
    </div>
  );
}
