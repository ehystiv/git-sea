import { useCallback, useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { CommandPalette } from "../features/palette/CommandPalette";
import { usePalette, usePaletteSource, type PaletteSource } from "../features/palette/paletteStore";
import { OpenRepoPanel } from "../features/repo/OpenRepoPanel";
import { RepoView } from "../features/repo/RepoView";
import { useOpenRepo } from "../features/repo/useOpenRepo";
import { useRepoDrop } from "../features/repo/useRepoDrop";
import { SettingsDialog } from "../features/settings/SettingsDialog";
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
  const { tabs, activeId, recents, restored, addTab, closeTab, activate, activateAt, moveTab, removeRecent, restore } = useTabs();
  const open = useOpenRepo();
  const { mutate, reset, error, isPending } = open;
  const m = useT();

  // Opening a repository that already has a tab just switches to it.
  const openPath = useCallback(
    (path: string) => {
      const wanted = normalizePath(path);
      const existing = findTabByPath(useTabs.getState(), wanted);
      if (existing) {
        activate(existing.id);
        return;
      }
      reset();
      mutate(wanted, { onSuccess: addTab });
    },
    [mutate, reset, addTab, activate],
  );
  const isDragging = useRepoDrop(openPath);

  // The tabs open at the last quit come back at launch.
  useEffect(() => {
    void restore();
  }, [restore]);

  const browse = useCallback(async () => {
    const path = await pickRepoFolder();
    if (path) openPath(path);
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
    return {
      commands: [
        { id: "app:open", group: m.palette.groups.repository, title: m.app.openRepo, shortcut: modShortcut("O"), keywords: "open cartella folder", run: () => void browse() },
        ...(activeId ? [{ id: "app:close", group: m.palette.groups.repository, title: m.app.closeTab, shortcut: modShortcut("W"), keywords: "close", run: closeActive }] : []),
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
          .map((r) => ({ id: `app:recent:${r.path}`, group: m.palette.groups.recent, title: m.app.openRecent(r.name), detail: r.path, keywords: "recent", run: () => openPath(r.path) })),
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
  }, [m, tabs, activeId, recents, themeMode, languageChoice, systemLanguage, browse, closeActive, activate, openPath, setTheme, setLanguage, openSettings]);
  usePaletteSource("app", paletteSource);
  const openPalette = usePalette((s) => s.setOpen);

  const hasTabs = tabs.length > 0;
  const errorText = error ? describeError(error) : null;

  return (
    <div className={styles.window}>
      <TitleBar tabs={tabs} activeId={activeId} onActivate={activate} onMove={moveTab} onClose={closeById} onNew={() => void browse()} onPalette={() => openPalette(true)} onSettings={() => openSettings(true)} />
      <CommandPalette />
      <SettingsDialog />

      {hasTabs && errorText && (
        <div className={styles.banner} role="alert">
          <span>{errorText}</span>
          <button type="button" onClick={reset} aria-label={m.app.dismissAlert}>
            ×
          </button>
        </div>
      )}

      <main className={styles.main}>
        {/* Every tab stays mounted, so its graph, selection and scroll position survive a switch. */}
        {tabs.map((tab) => (
          <div key={tab.id} className={`${styles.pane} ${tab.id === activeId ? styles.visible : ""}`}>
            <RepoView repo={tab.repo} active={tab.id === activeId} onClose={() => closeById(tab.id)} />
          </div>
        ))}

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
    </div>
  );
}
