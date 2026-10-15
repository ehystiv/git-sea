import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { OpenRepoPanel } from "../features/repo/OpenRepoPanel";
import { RepoView } from "../features/repo/RepoView";
import { useOpenRepo } from "../features/repo/useOpenRepo";
import { useRepoDrop } from "../features/repo/useRepoDrop";
import { commands } from "../lib/bindings";
import { pickRepoFolder } from "../lib/dialog";
import { describeError } from "../lib/errors";
import { findTabByPath, normalizePath } from "./tabsLogic";
import { useTabs } from "./tabsStore";
import { TitleBar } from "./TitleBar";
import styles from "./App.module.css";

export function App() {
  const { tabs, activeId, recents, addTab, closeTab, activate, activateAt, removeRecent } = useTabs();
  const open = useOpenRepo();
  const { mutate, reset, error, isPending } = open;

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

  // ⌘1…⌘9 switch tabs; ⌘9 goes to the last one.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key < "1" || event.key > "9") return;
      event.preventDefault();
      activateAt(Number(event.key) - 1, event.key === "9");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activateAt]);

  const hasTabs = tabs.length > 0;
  const errorText = error ? describeError(error) : null;

  return (
    <div className={styles.window}>
      <TitleBar tabs={tabs} activeId={activeId} onActivate={activate} onClose={closeById} onNew={() => void browse()} />

      {hasTabs && errorText && (
        <div className={styles.banner} role="alert">
          <span>{errorText}</span>
          <button type="button" onClick={reset} aria-label="Chiudi l'avviso">
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

        {!hasTabs && (
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
