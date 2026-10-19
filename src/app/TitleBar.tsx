import { useLayoutEffect, useRef, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useUpdates } from "../features/updates/updatesStore";
import { useT } from "../lib/i18n";
import { modShortcut } from "../lib/platform";
import { useTheme } from "../lib/theme";
import type { ThemeMode } from "../lib/themeLogic";
import { dragOffset, dropIndex, type Tab } from "./tabsLogic";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  tabs: Tab[];
  activeId: string | null;
  /** The two tabs of a split view, or null. */
  split: [string, string] | null;
  /** Right click on a tab, at window coordinates. */
  onTabMenu: (id: string, x: number, y: number) => void;
  onActivate: (id: string) => void;
  onMove: (id: string, to: number) => void;
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

/** Pixels the pointer must travel before a press on a tab becomes a drag. */
const DRAG_THRESHOLD = 4;
/** How the other tabs slide into the room left free, and the dragged one into its place. */
const SLIDE = { duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" } as const;

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface TabDrag {
  id: string;
  tab: HTMLElement;
  /** Where the pointer and the tab (its place in the row) were when the drag started. */
  startX: number;
  startLeft: number;
  pointerX: number;
}

/**
 * Reorders tabs by dragging them. Pointer events rather than HTML drag and drop, which the
 * webview's own file drop handling disables on Windows. Once the pointer has moved a little the
 * tab lifts and follows it; when its centre passes a neighbour's it takes that place and the
 * others slide aside, and when let go it settles into its place. The click that ends a drag does
 * not activate the tab. Positions are layout positions (`offsetLeft`), which the animations do
 * not change, so a tab sliding aside is never mistaken for one in its new place.
 */
function useTabDrag(tabs: Tab[], onMove: (id: string, to: number) => void) {
  const list = useRef<HTMLDivElement>(null);
  const swallowClick = useRef(false);
  const drag = useRef<TabDrag | null>(null);
  /** Where each tab was just before a reorder, to slide it from there to its new place. */
  const before = useRef<Map<string, number> | null>(null);

  const tabElements = () => Array.from(list.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []);

  /** Draws the dragged tab under the pointer, whatever its place in the row is now. */
  function follow(current: TabDrag) {
    const all = tabElements();
    const rowStart = Math.min(...all.map((el) => el.offsetLeft));
    const rowEnd = Math.max(...all.map((el) => el.offsetLeft + el.offsetWidth));
    const left = current.startLeft + (current.pointerX - current.startX);
    current.tab.style.transform = `translateX(${dragOffset(left, current.tab.offsetLeft, current.tab.offsetWidth, rowStart, rowEnd)}px)`;
  }

  // After a reorder: the dragged tab stays under the pointer, the others slide to their places.
  useLayoutEffect(() => {
    const current = drag.current;
    const previous = before.current;
    before.current = null;
    if (current) follow(current);
    if (!previous || reducedMotion()) return;
    for (const el of tabElements()) {
      if (el === current?.tab) continue;
      const was = previous.get(el.dataset.tabId ?? "");
      const delta = was === undefined ? 0 : was - el.offsetLeft;
      if (delta !== 0) el.animate([{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }], SLIDE);
    }
  }, [tabs]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-tab-close]")) return;
    const tab = event.currentTarget;
    const startX = event.clientX;
    let dragging = false;

    function move(e: PointerEvent) {
      if (!dragging && Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        drag.current = { id, tab, startX, startLeft: tab.offsetLeft, pointerX: e.clientX };
        tab.getAnimations().forEach((a) => a.cancel());
        tab.dataset.dragging = "";
        document.documentElement.dataset.draggingTab = "";
      }
      const current = drag.current;
      if (!current) return;
      current.pointerX = e.clientX;
      follow(current);

      const all = tabElements();
      const left = current.startLeft + (e.clientX - startX);
      const centers = all.filter((el) => el !== tab).map((el) => el.offsetLeft + el.offsetWidth / 2);
      const to = dropIndex(centers, left + tab.offsetWidth / 2);
      if (all.indexOf(tab) !== to) {
        before.current = new Map(all.map((el) => [el.dataset.tabId ?? "", el.offsetLeft]));
        onMove(id, to);
      }
    }
    function end() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      swallowClick.current = dragging;
      if (!dragging) return;
      drag.current = null;
      delete document.documentElement.dataset.draggingTab;
      // From under the pointer down into its place.
      const from = tab.style.transform;
      tab.style.transform = "";
      const settle = () => delete tab.dataset.dragging;
      if (reducedMotion() || !from) settle();
      else tab.animate([{ transform: from }, { transform: "translateX(0)" }], SLIDE).finished.then(settle, settle);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.stopPropagation();
  }

  return { list, onPointerDown, onClickCapture };
}

/**
 * Overlay title bar: the macOS traffic lights float over the reserved left padding and the empty
 * space is a drag region. Tabs and buttons are the only interactive parts.
 */
export function TitleBar({ tabs, activeId, split, onTabMenu, onActivate, onMove, onClose, onNew, onPalette, onSettings }: TitleBarProps) {
  const mode = useTheme((s) => s.mode);
  const cycleTheme = useTheme((s) => s.cycle);
  const m = useT();
  const themeLabel = m.titlebar.theme[mode];
  const drag = useTabDrag(tabs, onMove);
  const update = useUpdates((s) => s.status);
  const showUpdate = useUpdates((s) => s.setOpen);
  const updateVersion = update.kind === "available" || update.kind === "downloading" || update.kind === "installed" ? update.version : null;
  return (
    <header className={styles.titlebar} data-tauri-drag-region>
      <div ref={drag.list} className={styles.tabs} role="tablist" aria-label={m.titlebar.openRepos} onClickCapture={drag.onClickCapture}>
        {tabs.map((tab, i) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={`${styles.tab} ${tab.id === activeId ? styles.active : split?.includes(tab.id) ? styles.alongside : ""}`}
            onPointerDown={(event) => drag.onPointerDown(event, tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onTabMenu(tab.id, event.clientX, event.clientY);
            }}
          >
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
            <button type="button" data-tab-close className={styles.close} aria-label={m.titlebar.closeRepo(tab.repo.name)} title={m.titlebar.close(modShortcut("W"))} onClick={() => onClose(tab.id)}>
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
      {updateVersion && (
        <button type="button" className={styles.update} onClick={() => showUpdate(true)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          {m.updates.available(updateVersion)}
        </button>
      )}
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
