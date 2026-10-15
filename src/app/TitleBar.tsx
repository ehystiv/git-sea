import type { Tab } from "./tabsLogic";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

/**
 * Overlay title bar: the macOS traffic lights float over the reserved left padding and the empty
 * space is a drag region. Tabs and buttons are the only interactive parts.
 */
export function TitleBar({ tabs, activeId, onActivate, onClose, onNew }: TitleBarProps) {
  return (
    <header className={styles.titlebar} data-tauri-drag-region>
      <div className={styles.tabs} role="tablist" aria-label="Repository aperti">
        {tabs.map((tab, i) => (
          <div key={tab.id} className={`${styles.tab} ${tab.id === activeId ? styles.active : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className={styles.select}
              title={`${tab.repo.path}  (⌘${i + 1})`}
              onClick={() => onActivate(tab.id)}
            >
              <span className={styles.dot} style={{ background: `var(--b${tab.color})` }} />
              <span className={styles.name}>{tab.repo.name}</span>
            </button>
            <button type="button" className={styles.close} aria-label={`Chiudi ${tab.repo.name}`} title="Chiudi (⌘W)" onClick={() => onClose(tab.id)}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className={styles.add} aria-label="Apri repository" title="Apri repository (⌘O)" onClick={onNew}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
      </div>
    </header>
  );
}
