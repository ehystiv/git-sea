import { useState, type FormEvent } from "react";
import { Button } from "../../components/Button/Button";
import { Kbd } from "../../components/Kbd/Kbd";
import type { RecentRepo } from "../../app/tabsLogic";
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

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = path.trim();
    if (trimmed) onOpen(trimmed);
  }

  return (
    <section className={`${styles.panel} ${isDragging ? styles.dragging : ""}`}>
      <h1 className={styles.title}>Apri un repository</h1>
      <p className={styles.hint}>Trascina qui una cartella, scegline una o incolla il percorso.</p>

      <div className={styles.browse}>
        <Button variant="ghost" onClick={onBrowse} disabled={isPending}>
          Sfoglia…
        </Button>
        <Kbd>⌘O</Kbd>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/…/mio-repo"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Percorso del repository"
        />
        <Button type="submit" disabled={isPending || path.trim() === ""}>
          {isPending ? "Apro…" : "Apri"}
        </Button>
      </form>

      {recents.length > 0 && (
        <div className={styles.recents}>
          <h2>Recenti</h2>
          <ul>
            {recents.map((recent) => (
              <li key={recent.path}>
                <button type="button" className={styles.recent} disabled={isPending} onClick={() => onOpen(recent.path)} title={recent.path}>
                  <span className={styles.recentName}>{recent.name}</span>
                  <code className={styles.recentPath}>{recent.path}</code>
                </button>
                <button type="button" className={styles.forget} aria-label={`Rimuovi ${recent.name} dai recenti`} title="Rimuovi dai recenti" onClick={() => onRemoveRecent(recent.path)}>
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
