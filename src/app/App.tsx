import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ContextMenu, type MenuItem } from "../components/ContextMenu/ContextMenu";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "../features/palette/CommandPalette";
import { usePalette, usePaletteSource, type PaletteSource } from "../features/palette/paletteStore";
import { OpenRepoPanel } from "../features/repo/OpenRepoPanel";
import { RepoView } from "../features/repo/RepoView";
import { useOpenRepo } from "../features/repo/useOpenRepo";
import { useRepoDrop } from "../features/repo/useRepoDrop";
import { SettingsDialog } from "../features/settings/SettingsDialog";
import { UpdateDialog } from "../features/updates/UpdateDialog";
import { useAutoUpdateCheck } from "../features/updates/useAutoUpdateCheck";
import { useSettings } from "../features/settings/settingsStore";
import { commands } from "../lib/bindings";
import { pickRepoFolder } from "../lib/dialog";
import { describeError } from "../lib/errors";
import { LANGUAGE_CHOICES, useLanguage, useSystemLanguage, useT } from "../lib/i18n";
import { hasModKey, modShortcut } from "../lib/platform";
import { useTheme } from "../lib/theme";
import { findTabByPath, normalizePath } from "./tabsLogic";
import { useTabs } from "./tabsStore";
import { TitleBar } from "./TitleBar";
import styles from "./App.module.css";

export function App() {
  const { tabs, activeId, split, recents, restored, addTab, addTabAlongside, closeTab, activate, activateAt, moveTab, openSplit, closeSplit, swapSplit, removeRecent, restore } = useTabs();
  const open = useOpenRepo();
  const { mutate, reset, error, isPending } = open;
  const m = useT();

  // Opening a repository that already has a tab just switches to it. `alongside` shows it below
  // the active one, in a split view.
  const openPath = useCallback(
    (path: string, alongside = false) => {
      const wanted = normalizePath(path);
      const existing = findTabByPath(useTabs.getState(), wanted);
      if (existing) {
        if (alongside) openSplit(existing.id);
        else activate(existing.id);
        return;
      }
      reset();
      mutate(wanted, { onSuccess: alongside ? addTabAlongside : addTab });
    },
    [mutate, reset, addTab, addTabAlongside, activate, openSplit],
  );
  const isDragging = useRepoDrop(openPath);

  useAutoUpdateCheck();

  // The tabs open at the last quit come back at launch.
  useEffect(() => {
    void restore();
  }, [restore]);

  const browse = useCallback(async () => {
    const path = await pickRepoFolder();
    if (path) openPath(path);
  }, [openPath]);
  const browseAlongside = useCallback(async () => {
    const path = await pickRepoFolder();
    if (path) openPath(path, true);
  }, [openPath]);

  // Closing releases the backend session, which also stops any load still running on it.
  const closeById = useCallback(
    (id: string) => {
      void commands.closeRepo(id);
      closeTab(id);
    },
    [closeTab],
  );
  const closeActive = useCallback(() => {
    const id = useTabs.getState().activeId;
    if (id) closeById(id);
  }, [closeById]);

  // The native menu (⌘O, ⌘W) tells us what was chosen; the handlers are read through a ref so
  // the listener is set up once.
  const openSettings = useSettings((s) => s.setOpen);
  const menuHandlers = useRef({ browse, closeActive });
  useEffect(() => {
    menuHandlers.current = { browse, closeActive };
  }, [browse, closeActive]);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("menu", (event) => {
      if (event.payload === "open_repo") void menuHandlers.current.browse();
      else if (event.payload === "close_tab") menuHandlers.current.closeActive();
      else if (event.payload === "settings") useSettings.getState().setOpen(true);
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      // Outside Tauri (a plain browser) there is no menu.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ⌘1…⌘9 (Ctrl on Linux) switch tabs; ⌘9 goes to the last one.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!hasModKey(event) || event.altKey || event.shiftKey) return;
      if (event.key < "1" || event.key > "9") return;
      event.preventDefault();
      activateAt(Number(event.key) - 1, event.key === "9");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateAt]);

  // What the window offers to the command palette (the active repository adds its own).
  const setTheme = useTheme((s) => s.setMode);
  const themeMode = useTheme((s) => s.mode);
  const languageChoice = useLanguage((s) => s.choice);
  const setLanguage = useLanguage((s) => s.setChoice);
  const systemLanguage = useSystemLanguage();
  const paletteSource = useMemo((): PaletteSource => {
    const openPaths = new Set(tabs.map((t) => t.repo.path));
    const shown = (id: string) => id === activeId || (split?.includes(id) ?? false);
    const splitKeywords = "split divisa affianca alongside insieme";
    return {
      commands: [
        { id: "app:open", group: m.palette.groups.repository, title: m.app.openRepo, shortcut: modShortcut("O"), keywords: "open cartella folder", run: () => void browse() },
        ...(activeId ? [{ id: "app:close", group: m.palette.groups.repository, title: m.app.closeTab, shortcut: modShortcut("W"), keywords: "close", run: closeActive }] : []),
        ...(activeId ? [{ id: "app:open-split", group: m.palette.groups.repository, title: m.app.openInSplit, keywords: `open ${splitKeywords}`, run: () => void browseAlongside() }] : []),
        ...(split
          ? [
              { id: "app:close-split", group: m.palette.groups.repository, title: m.app.closeSplit, keywords: splitKeywords, run: closeSplit },
              { id: "app:swap-split", group: m.palette.groups.repository, title: m.app.swapSplit, keywords: `swap scambia ${splitKeywords}`, run: swapSplit },
            ]
          : []),
        ...(activeId
          ? tabs
              .filter((t) => !shown(t.id))
              .map((t) => ({ id: `app:split:${t.id}`, group: m.palette.groups.repository, title: m.app.splitWith(t.repo.name), detail: t.repo.path, keywords: splitKeywords, run: () => openSplit(t.id) }))
          : []),
        ...tabs
          .filter((t) => t.id !== activeId)
          .map((t, i) => ({
            id: `app:tab:${t.id}`,
            group: m.palette.groups.repository,
            title: m.app.switchTo(t.repo.name),
            detail: t.repo.path,
            shortcut: i < 8 ? modShortcut(String(tabs.indexOf(t) + 1)) : undefined,
            keywords: "tab switch",
            run: () => activate(t.id),
          })),
        ...recents
          .filter((r) => !openPaths.has(r.path))
          .flatMap((r) => [
            { id: `app:recent:${r.path}`, group: m.palette.groups.recent, title: m.app.openRecent(r.name), detail: r.path, keywords: "recent", run: () => openPath(r.path) },
            ...(activeId ? [{ id: `app:recent-split:${r.path}`, group: m.palette.groups.recent, title: m.app.openRecentInSplit(r.name), detail: r.path, keywords: `recent ${splitKeywords}`, run: () => openPath(r.path, true) }] : []),
          ]),
        ...(["system", "light", "dark"] as const)
          .filter((mode) => mode !== themeMode)
          .map((mode) => ({
            id: `app:theme:${mode}`,
            group: m.palette.groups.appearance,
            title: mode === "system" ? m.app.themeSystem : mode === "light" ? m.app.themeLight : m.app.themeDark,
            keywords: "theme dark light aspetto",
            run: () => setTheme(mode),
          })),
        ...LANGUAGE_CHOICES.filter((choice) => choice !== languageChoice).map((choice) => ({
          id: `app:language:${choice}`,
          group: m.palette.groups.settings,
          title: m.app.languageTo(choice === "system" ? m.language.system(m.language[systemLanguage]) : m.language[choice]),
          keywords: "language lingua english italiano inglese",
          run: () => setLanguage(choice),
        })),
        { id: "app:settings", group: m.palette.groups.settings, title: m.app.settings, shortcut: modShortcut(","), keywords: "settings impostazioni preferenze preferences", run: () => openSettings(true) },
      ],
    };
  }, [m, tabs, activeId, split, recents, themeMode, languageChoice, systemLanguage, browse, browseAlongside, closeActive, activate, openPath, openSplit, closeSplit, swapSplit, setTheme, setLanguage, openSettings]);
  usePaletteSource("app", paletteSource);
  const openPalette = usePalette((s) => s.setOpen);

  const hasTabs = tabs.length > 0;
  const errorText = error ? describeError(error) : null;

  // The split view's button and the tabs' right click open a small menu.
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const splitChoices = useCallback(
    (from: string): MenuItem[] => [
      ...tabs.filter((t) => t.id !== from).map((t) => ({ id: `split:${t.id}`, label: m.app.splitWith(t.repo.name), run: () => openSplit(t.id) })),
      { id: "split:open", label: m.app.openInSplit, run: () => void browseAlongside(), separated: tabs.length > 1 },
    ],
    [m, tabs, openSplit, browseAlongside],
  );
  const onSplitButton = useCallback(
    (id: string, x: number, y: number) => {
      if (useTabs.getState().split) closeSplit();
      else setMenu({ x, y, items: splitChoices(id) });
    },
    [closeSplit, splitChoices],
  );
  const onTabMenu = useCallback(
    (id: string, x: number, y: number) => {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      const items: MenuItem[] = [];
      if (activeId && !(split?.includes(id) ?? id === activeId)) items.push({ id: "split", label: m.app.splitWith(tab.repo.name), run: () => openSplit(id) });
      if (split) {
        items.push({ id: "swap", label: m.app.swapSplit, run: swapSplit });
        items.push({ id: "close-split", label: m.app.closeSplit, run: closeSplit });
      }
      items.push({ id: "close", label: m.app.closeTab, run: () => closeById(id), separated: items.length > 0 });
      setMenu({ x, y, items });
    },
    [m, tabs, activeId, split, openSplit, swapSplit, closeSplit, closeById],
  );

  // Where the two halves of a split view meet, as a share of the height; double click resets it.
  const mainRef = useRef<HTMLElement>(null);
  const [splitAt, setSplitAt] = useState(0.5);
  const startSplitResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const main = mainRef.current;
    if (event.button !== 0 || !main) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      const rect = main.getBoundingClientRect();
      if (rect.height > 0) setSplitAt(Math.min(0.8, Math.max(0.2, (e.clientY - rect.top) / rect.height)));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }, []);

  return (
    <div className={styles.window}>
      <TitleBar tabs={tabs} activeId={activeId} split={split} onTabMenu={onTabMenu} onActivate={activate} onMove={moveTab} onClose={closeById} onNew={() => void browse()} onPalette={() => openPalette(true)} onSettings={() => openSettings(true)} />
      <CommandPalette />
      <SettingsDialog />
      <UpdateDialog />

      {hasTabs && errorText && (
        <div className={styles.banner} role="alert">
          <span>{errorText}</span>
          <button type="button" onClick={reset} aria-label={m.app.dismissAlert}>
            ×
          </button>
        </div>
      )}

      <main ref={mainRef} className={`${styles.main} ${split ? styles.split : ""}`} style={{ "--split-at": `${splitAt * 100}%` } as CSSProperties}>
        {/* Every tab stays mounted, so its graph, selection and scroll position survive a switch. */}
        {tabs.map((tab) => {
          const place = split ? (split[0] === tab.id ? styles.top : split[1] === tab.id ? styles.bottom : null) : tab.id === activeId ? "" : null;
          const focused = split !== null && tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={`${styles.pane} ${place !== null ? `${styles.visible} ${place}` : ""} ${focused ? styles.focused : ""}`}
              // In a split view, a press anywhere in a half gives it the keyboard.
              onPointerDownCapture={split && place !== null && tab.id !== activeId ? () => activate(tab.id) : undefined}
            >
              <RepoView
                repo={tab.repo}
                visible={place !== null}
                active={tab.id === activeId}
                split={split !== null}
                onSplit={(x, y) => onSplitButton(tab.id, x, y)}
                onClose={() => closeById(tab.id)}
              />
            </div>
          );
        })}
        {split && (
          <div
            className={styles.divider}
            onPointerDown={startSplitResize}
            onDoubleClick={() => setSplitAt(0.5)}
            role="separator"
            aria-orientation="horizontal"
            aria-label={m.app.resizeSplit}
            title={m.app.resizeSplitTitle}
          />
        )}

        {/* While the saved tabs reopen, the start screen would only flash. */}
        {!hasTabs && restored && (
          <div className={styles.empty}>
            <OpenRepoPanel
              isPending={isPending}
              isDragging={isDragging}
              error={errorText}
              onOpen={openPath}
              onBrowse={() => void browse()}
              recents={recents}
              onRemoveRecent={removeRecent}
            />
          </div>
        )}
      </main>

      {menu && <ContextMenu x={menu.x} y={menu.y} label={m.titlebar.tabMenu} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
