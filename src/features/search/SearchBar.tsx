import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Kbd } from "../../components/Kbd/Kbd";
import { formatCount, formatRelative, shortHash } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { GraphIndex } from "../graph/GraphIndex";
import { searchHelp } from "./query";
import type { SearchState } from "./useSearch";
import styles from "./SearchBar.module.css";

const ROW_HEIGHT = 30;
const MAX_ROWS = 8;

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  search: SearchState;
  /** The full history, to show the matching commits. */
  index: GraphIndex;
  /** Position of the selected commit among the matches, or null. */
  current: number | null;
  /** How many distinct places the matches are in the current view (a compressed node counts once). */
  targets: number;
  onStep: (step: 1 | -1) => void;
  onPick: (id: string) => void;
  /** Bumped to move the focus back into the field (`/` while it is already open). */
  focusSignal: number;
}

/** Find-in-history bar floating over the canvas, with the matches listed under it. */
export function SearchBar({ value, onChange, onClose, search, index, current, targets, onStep, onPick, focusSignal }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(true);
  const m = useT();
  const [now] = useState(() => Date.now());
  const ids = search.ids ?? [];

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  const selectedId = current === null ? null : (ids[current] ?? null);
  useEffect(() => {
    if (current !== null && current < ids.length) virtualizer.scrollToIndex(current, { align: "auto" });
  }, [current, ids.length, virtualizer]);

  let status: string;
  if (search.invalid) status = search.invalid;
  else if (search.query === null) status = "";
  else if (search.error) status = m.search.error;
  else if (search.ids === null) status = m.search.searching;
  else if (ids.length === 0) status = search.pending ? m.search.searching : m.search.noResults;
  else {
    const total = `${formatCount(ids.length)}${search.truncated ? "+" : ""}`;
    status = current === null ? m.search.results(total) : m.search.position(formatCount(current + 1), total);
  }

  const showList = focused && ids.length > 0;
  const showHelp = focused && value.trim() === "";

  return (
    <div className={styles.bar} role="search">
      <div className={styles.field}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={search.pending ? styles.busy : undefined}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              onStep(e.shiftKey || e.key === "ArrowUp" ? -1 : 1);
            }
          }}
          placeholder={m.search.placeholder}
          spellCheck={false}
          aria-label={m.search.label}
        />
        <span
          className={`${styles.status} ${search.invalid ? styles.invalid : ""}`}
          title={search.invalid ?? search.error ?? (targets !== ids.length ? m.search.inView(targets) : undefined)}
        >
          {status}
        </span>
        <button type="button" className={styles.icon} aria-label={m.search.previous} title={m.search.previousTitle} disabled={ids.length === 0} onClick={() => onStep(-1)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
        <button type="button" className={styles.icon} aria-label={m.search.next} title={m.search.nextTitle} disabled={ids.length === 0} onClick={() => onStep(1)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button type="button" className={styles.icon} aria-label={m.search.close} title={m.search.closeTitle} onClick={onClose}>
          ×
        </button>
      </div>

      {showHelp && (
        <ul className={styles.help}>
          {searchHelp(m).map(({ prefix, meaning }) => (
            <li key={prefix || "text"}>
              {prefix ? (
                <span className={styles.keys}>
                  {prefix.split(" ").map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              ) : (
                <span className={styles.plain}>{m.search.text}</span>
              )}
              <span>{meaning}</span>
            </li>
          ))}
        </ul>
      )}

      {showList && (
        <div ref={scrollRef} className={styles.results} style={{ height: Math.min(ids.length, MAX_ROWS) * ROW_HEIGHT + 8 }}>
          <div className={styles.canvas} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const id = ids[item.index];
              const at = id === undefined ? null : index.indexOf(id);
              const commit = at === null ? undefined : index.commits[at];
              if (!id || !commit) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className={`${styles.row} ${id === selectedId ? styles.selected : ""}`}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                  // Keep the focus in the field, so Enter keeps stepping.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(id)}
                >
                  <span className={styles.summary}>{commit.summary}</span>
                  <span className={styles.author}>{commit.author}</span>
                  <span className={styles.date}>{formatRelative(commit.time ?? 0, now)}</span>
                  <span className={styles.hash}>{shortHash(id)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
