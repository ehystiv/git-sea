import { useTheme } from "../lib/theme";
import type { ThemeMode } from "../lib/themeLogic";
import type { Tab } from "./tabsLogic";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onPalette: () => void;
}

const THEME_LABEL: Record<ThemeMode, string> = { system: "Tema: sistema", light: "Tema: chiaro", dark: "Tema: scuro" };
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
      {mode === "light" && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      )}
      {mode === "dark" && <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />}
      {mode === "system" && (
        <>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      )}
    </svg>
  );
}

/**
 * Overlay title bar: the macOS traffic lights float over the reserved left padding and the empty
 * space is a drag region. Tabs and buttons are the only interactive parts.
 */
export function TitleBar({ tabs, activeId, onActivate, onClose, onNew, onPalette }: TitleBarProps) {
  const mode = useTheme((s) => s.mode);
  const cycleTheme = useTheme((s) => s.cycle);
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
      <button type="button" className={styles.palette} title="Comandi (⌘K)" onClick={onPalette}>
        <svg viewBox="0 0 24 24" width="13" height="13" {...stroke}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>Comandi</span>
        <kbd>⌘K</kbd>
      </button>
      <button type="button" className={styles.theme} aria-label={THEME_LABEL[mode]} title={`${THEME_LABEL[mode]} (clic per cambiare)`} onClick={cycleTheme}>
        <ThemeIcon mode={mode} />
      </button>
    </header>
  );
}
