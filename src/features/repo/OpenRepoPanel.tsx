import { useState, type FormEvent } from "react";
import { Button } from "../../components/Button/Button";
import { Kbd } from "../../components/Kbd/Kbd";
import type { RecentRepo } from "../../app/tabsLogic";
import { useT } from "../../lib/i18n";
import { modShortcut } from "../../lib/platform";
import styles from "./OpenRepoPanel.module.css";

interface OpenRepoPanelProps {
  isPending: boolean;
  isDragging: boolean;
  error: string | null;
  onOpen: (path: string) => void;
  onBrowse: () => void;
  recents: RecentRepo[];
  onRemoveRecent: (path: string) => void;
}

export function OpenRepoPanel({ isPending, isDragging, error, onOpen, onBrowse, recents, onRemoveRecent }: OpenRepoPanelProps) {
  const [path, setPath] = useState("");
  const m = useT();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = path.trim();
    if (trimmed) onOpen(trimmed);
  }

  return (
    <section className={`${styles.panel} ${isDragging ? styles.dragging : ""}`}>
      <h1 className={styles.title}>{m.openPanel.title}</h1>
      <p className={styles.hint}>{m.openPanel.hint}</p>

      <div className={styles.browse}>
        <Button variant="ghost" onClick={onBrowse} disabled={isPending}>
          {m.openPanel.browse}
        </Button>
        <Kbd>{modShortcut("O")}</Kbd>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={m.openPanel.placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={m.openPanel.pathLabel}
        />
        <Button type="submit" disabled={isPending || path.trim() === ""}>
          {isPending ? m.openPanel.opening : m.openPanel.open}
        </Button>
      </form>

      {recents.length > 0 && (
        <div className={styles.recents}>
          <h2>{m.openPanel.recent}</h2>
          <ul>
            {recents.map((recent) => (
              <li key={recent.path}>
                <button type="button" className={styles.recent} disabled={isPending} onClick={() => onOpen(recent.path)} title={recent.path}>
                  <span className={styles.recentName}>{recent.name}</span>
                  <code className={styles.recentPath}>{recent.path}</code>
                </button>
                <button type="button" className={styles.forget} aria-label={m.openPanel.forgetLabel(recent.name)} title={m.openPanel.forget} onClick={() => onRemoveRecent(recent.path)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
