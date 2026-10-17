import { useT } from "../lib/i18n";
import { modShortcut } from "../lib/platform";
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
  onSettings: () => void;
}

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
export function TitleBar({ tabs, activeId, onActivate, onClose, onNew, onPalette, onSettings }: TitleBarProps) {
  const mode = useTheme((s) => s.mode);
  const cycleTheme = useTheme((s) => s.cycle);
  const m = useT();
  const themeLabel = m.titlebar.theme[mode];
  return (
    <header className={styles.titlebar} data-tauri-drag-region>
      <div className={styles.tabs} role="tablist" aria-label={m.titlebar.openRepos}>
        {tabs.map((tab, i) => (
          <div key={tab.id} className={`${styles.tab} ${tab.id === activeId ? styles.active : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className={styles.select}
              title={`${tab.repo.path}  (${modShortcut(String(i + 1))})`}
              onClick={() => onActivate(tab.id)}
            >
              <span className={styles.dot} style={{ background: `var(--b${tab.color})` }} />
              <span className={styles.name}>{tab.repo.name}</span>
            </button>
            <button type="button" className={styles.close} aria-label={m.titlebar.closeRepo(tab.repo.name)} title={m.titlebar.close(modShortcut("W"))} onClick={() => onClose(tab.id)}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className={styles.add} aria-label={m.titlebar.openRepo} title={m.titlebar.openRepoTitle(modShortcut("O"))} onClick={onNew}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
      </div>
      <button type="button" className={styles.palette} title={m.titlebar.commandsTitle(modShortcut("K"))} onClick={onPalette}>
        <svg viewBox="0 0 24 24" width="13" height="13" {...stroke}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>{m.titlebar.commands}</span>
        <kbd>{modShortcut("K")}</kbd>
      </button>
      <button type="button" className={styles.theme} aria-label={themeLabel} title={m.titlebar.themeTitle(themeLabel)} onClick={cycleTheme}>
        <ThemeIcon mode={mode} />
      </button>
      <button type="button" className={styles.theme} aria-label={m.titlebar.settings} title={m.titlebar.settingsTitle(modShortcut(","))} onClick={onSettings}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  );
}
