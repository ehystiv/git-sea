import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { CommitList } from "../commits/CommitList";
import { LoadStatus } from "../commits/LoadStatus";
import { useCommitStream } from "../commits/useCommitStream";
import { DetailsPanel } from "../details/DetailsPanel";
import { useWorktreeStatus } from "../details/useWorktree";
import { WorktreePanel } from "../details/WorktreePanel";
import { ancestorEmphasis, ancestorMask, matchEmphasis, type Emphasis } from "../graph/emphasis";
import type { WorktreeMarker } from "../graph/draw";
import { GraphCanvas, type GraphCanvasHandle } from "../graph/GraphCanvas";
import { useCompressedIndex } from "../graph/useCompressedIndex";
import { usePalette, usePaletteSource } from "../palette/paletteStore";
import { stepMatch } from "../search/query";
import { SearchBar } from "../search/SearchBar";
import { useSearch } from "../search/useSearch";
import { TimelineCanvas } from "../timeline/TimelineCanvas";
import { describeFilter, pruneFilter, toggleRef } from "../sidebar/refFilter";
import { Sidebar } from "../sidebar/Sidebar";
import { useFlow } from "../../lib/flow";
import { useSea } from "../../lib/sea";
import { shortHash } from "../../lib/format";
import { headCommitId } from "./head";
import { useDrawer } from "./useDrawer";
import { useFetchStatus } from "./useFetchStatus";
import { useRepoChanges } from "./useRepoChanges";
import { useRepoCommands, type RepoCommandActions, type ViewMode } from "./useRepoCommands";
import type { CommitSummary, HeadInfo, RefFilter, RepoInfo } from "../../lib/bindings";
import styles from "./RepoView.module.css";

const PANEL_MIN = 320;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 440;
/** Space around the floating details panel, as `--space-3` in RepoView.module.css. */
const PANEL_GAP = 12;

function describeHead(head: HeadInfo): { label: string; detail?: string } {
  switch (head.kind) {
    case "Branch":
      return { label: head.name, detail: shortHash(head.commit) };
    case "Detached":
      return { label: "HEAD scollegato", detail: shortHash(head.commit) };
    case "Unborn":
      return { label: head.name, detail: "nessun commit" };
  }
}

interface RepoViewProps {
  repo: RepoInfo;
  /** False for a tab in the background: it stays mounted but ignores the keyboard. */
  active: boolean;
  onClose: () => void;
}

/** The same object on every render, calling the latest version of each function. */
function useStableActions<T extends object>(actions: T): T {
  const ref = useRef(actions);
  useLayoutEffect(() => {
    ref.current = actions;
  });
  return useMemo(() => {
    const stable = {} as Record<string, unknown>;
    for (const key of Object.keys(actions)) {
      stable[key] = (...args: unknown[]) => (ref.current as Record<string, (...a: unknown[]) => unknown>)[key]?.(...args);
    }
    return stable as T;
    // The keys never change, only the functions behind them.
  }, []);
}

export function RepoView({ repo, active, onClose }: RepoViewProps) {
  const [branchFilter, setBranchFilter] = useState<RefFilter[] | null>(null);
  const stream = useCommitStream(repo.sessionId, branchFilter);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchFocus, setSearchFocus] = useState(0);
  const [ancestors, setAncestors] = useState(false);
  const [selected, setSelected] = useState<CommitSummary | null>(null);
  /** The details panel shows the local changes instead of the selected commit. */
  const [showWorktree, setShowWorktree] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const head = describeHead(repo.head);
  const { index, reload } = stream;
  const flow = useFlow((s) => s.enabled);
  const toggleFlow = useFlow((s) => s.toggle);
  const sea = useSea((s) => s.enabled);
  const toggleSea = useSea((s) => s.toggle);
  const compressed = useCompressedIndex(index, stream.version, mode === "topology");
  const canvasIndex = mode === "topology" ? compressed.index : index;
  const canvasVersion = mode === "topology" ? compressed.version : stream.version;
  const queryClient = useQueryClient();
  const search = useSearch(repo.sessionId, index, stream.version, searchOpen ? searchText : "");

  // A commit, fetch, branch or tag changed the refs: reload quietly and refresh the stashes and
  // any search that read the history.
  useRepoChanges(
    repo.sessionId,
    useCallback(() => {
      reload();
      void queryClient.invalidateQueries({ queryKey: ["stashes", repo.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["search", repo.sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["worktree", repo.sessionId] });
    }, [reload, queryClient, repo.sessionId]),
  );

  // Remote branches are fetched in the background; new commits arrive through the refs.
  const remote = useFetchStatus(repo.sessionId);

  // Files edited, staged or unstaged: count the local changes again.
  const worktree = useWorktreeStatus(repo.sessionId, !repo.isBare);
  useRepoChanges(
    repo.sessionId,
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["worktree", repo.sessionId] });
    }, [queryClient, repo.sessionId]),
    "worktree-changed",
  );
  const worktreeMarker = useMemo((): WorktreeMarker | null => {
    const data = worktree.data;
    return data?.head && data.files > 0 ? { id: data.head, files: data.files } : null;
  }, [worktree.data]);
  const openWorktree = useCallback(() => {
    setShowWorktree(true);
    setPanelOpen(true);
  }, []);

  // Picking another commit brings its details back. Views report their selection again when they
  // are created, so only a different commit counts.
  const selectedIdRef = useRef<string | null>(null);
  const selectCommit = useCallback((commit: CommitSummary | null) => {
    if (commit && commit.id !== selectedIdRef.current) setShowWorktree(false);
    selectedIdRef.current = commit?.id ?? null;
    setSelected(commit);
  }, []);

  // A branch of the filter was deleted: drop it, rather than keep an empty or partial graph.
  useEffect(() => {
    if (branchFilter === null || index.refs.size === 0) return;
    const pruned = pruneFilter(branchFilter, [...index.refs.values()].flat());
    if (pruned !== branchFilter) setBranchFilter(pruned);
  }, [stream.version, index, branchFilter]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setSearchFocus((n) => n + 1);
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchText("");
  }, []);

  // Enter shows or hides the details panel; 1, 2 and 3 switch between graph, topology and
  // timeline; / opens the search; a highlights the ancestors of the selected commit.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const onButton = target?.tagName === "BUTTON";
      if (typing || event.metaKey || event.ctrlKey || event.altKey || usePalette.getState().open) return;
      if (event.key === "Enter" && !onButton) {
        event.preventDefault();
        setPanelOpen((open) => !open);
      } else if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        setMode(event.key === "1" ? "graph" : event.key === "2" ? "topology" : "timeline");
      } else if (event.key === "/") {
        event.preventDefault();
        openSearch();
      } else if (event.key === "a") {
        event.preventDefault();
        setAncestors((on) => !on);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, openSearch]);

  const selectById = useCallback(
    (id: string) => {
      if (mode !== "list") {
        graphRef.current?.selectById(id);
        return;
      }
      const at = index.indexOf(id);
      const commit = at === null ? undefined : index.commits[at];
      if (commit) selectCommit(commit);
    },
    [mode, index, selectCommit],
  );

  // ---- search, ancestors and filter ------------------------------------------------------

  /** The index the current view draws: the compressed one in topology, else the full one. */
  const viewIndex = mode === "topology" ? compressed.index : index;
  const viewVersion = mode === "topology" ? compressed.version : stream.version;
  const searchIds = searchOpen ? search.ids : null;

  // Stepping goes from place to place in the view: matches hidden in one compressed node count once.
  const targets = useMemo(() => {
    if (!searchIds) return [];
    const seen = new Set<number>();
    const out: string[] = [];
    for (const id of searchIds) {
      const at = viewIndex.indexOf(id);
      if (at === null || seen.has(at)) continue;
      seen.add(at);
      out.push(id);
    }
    return out;
  }, [searchIds, viewIndex, viewVersion]);

  const selectedId = selected?.id ?? null;
  const currentMatch = useMemo(() => {
    if (!searchIds || selectedId === null) return null;
    const at = searchIds.indexOf(selectedId);
    return at < 0 ? null : at;
  }, [searchIds, selectedId]);

  const stepSearch = useCallback(
    (step: 1 | -1) => {
      if (targets.length === 0) return;
      const selectedAt = selectedId === null ? null : viewIndex.indexOf(selectedId);
      const position = selectedAt === null ? -1 : targets.findIndex((id) => viewIndex.indexOf(id) === selectedAt);
      const next = stepMatch(targets.length, position < 0 ? null : position, step);
      const id = next === null ? undefined : targets[next];
      if (id) selectById(id);
    },
    [targets, selectedId, viewIndex, selectById],
  );

  const emphasis = useMemo((): Emphasis | null => {
    if (mode === "list") return null;
    if (searchIds && searchIds.length > 0) return matchEmphasis(viewIndex, searchIds);
    if (!ancestors || selectedId === null) return null;
    const at = viewIndex.indexOf(selectedId);
    if (at === null) return null;
    // The timeline draws its own links between commits, so it only needs the commits.
    return mode === "timeline" ? { nodes: ancestorMask(viewIndex, at), edges: null, edgeStart: null } : ancestorEmphasis(viewIndex, at);
  }, [mode, searchIds, ancestors, selectedId, viewIndex, viewVersion]);

  const listCommits = useMemo(() => {
    if (!searchIds) return index.commits;
    return searchIds.flatMap((id) => {
      const commit = index.commits[index.indexOf(id) ?? -1];
      return commit ? [commit] : [];
    });
  }, [searchIds, index, stream.version]);

  const toggleFilter = useCallback((ref: RefFilter) => setBranchFilter((filter) => toggleRef(filter, ref)), []);

  const goHead = useCallback(() => {
    // The refs are fresher than `repo.head`, which is from when the tab opened.
    const head = [...index.refs.values()].flat().find((l) => l.kind === "Head");
    const id = head?.commit ?? headCommitId(repo.head);
    if (id !== null) selectById(id);
  }, [index, repo.head, selectById]);

  const actions = useStableActions<RepoCommandActions>({
    setMode,
    togglePanel: () => setPanelOpen((open) => !open),
    toggleFlow,
    toggleSea,
    toggleAncestors: () => setAncestors((on) => !on),
    openSearch,
    goHead,
    zoomIn: () => graphRef.current?.zoomIn(),
    zoomOut: () => graphRef.current?.zoomOut(),
    fit: () => graphRef.current?.fit(),
    collapseAll: compressed.collapseAll,
    selectCommit: selectById,
    toggleFilter,
    showOnly: (ref) => setBranchFilter([ref]),
    clearFilter: () => setBranchFilter(null),
  });
  usePaletteSource(
    `repo:${repo.sessionId}`,
    useRepoCommands(
      active,
      {
        index,
        version: stream.version,
        mode,
        panelOpen,
        flow,
        sea,
        ancestors,
        hasSelection: selected !== null,
        canCollapse: mode === "topology" && compressed.expandedCount > 0,
        branchFilter,
      },
      actions,
    ),
  );

  // Show HEAD's commit as soon as it has been loaded, unless the user picked something first.
  const headHandled = useRef(false);
  useEffect(() => {
    if (headHandled.current) return;
    const id = headCommitId(repo.head);
    if (id === null || selected !== null) {
      headHandled.current = true;
      return;
    }
    if (index.indexOf(id) !== null) {
      headHandled.current = true;
      selectById(id);
    } else if (stream.status !== "loading") {
      headHandled.current = true; // it never arrived (should not happen); give up quietly
    }
  }, [stream.version, stream.status, repo.head, index, selected, selectById]);

  const insetRight = panelOpen ? panelWidth + PANEL_GAP * 2 : 0;
  const drawer = useDrawer(panelOpen);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => {
      setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + (startX - e.clientX))));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  return (
    <div className={styles.view}>
      <Sidebar
        sessionId={repo.sessionId}
        index={index}
        version={stream.version}
        selectedId={selected?.id ?? null}
        onSelectCommit={selectById}
        branchFilter={branchFilter}
        onToggleFilter={toggleFilter}
      />

      <div className={styles.content}>
      <div className={styles.toolbar}>
        <Badge color={0}>{head.label}</Badge>
        {head.detail && <code className={styles.detail}>{head.detail}</code>}
        <span className={styles.meta}>{repo.refCount} riferimenti</span>
        {repo.isBare && <span className={styles.meta}>bare</span>}

        <div className={styles.seg} role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={mode === "graph"} className={mode === "graph" ? styles.active : undefined} title="Grafo (1)" onClick={() => setMode("graph")}>
            Grafo
          </button>
          <button type="button" role="tab" aria-selected={mode === "topology"} className={mode === "topology" ? styles.active : undefined} title="Topologia (2)" onClick={() => setMode("topology")}>
            Topologia
          </button>
          <button type="button" role="tab" aria-selected={mode === "timeline"} className={mode === "timeline" ? styles.active : undefined} title="Timeline (3)" onClick={() => setMode("timeline")}>
            Timeline
          </button>
          <button type="button" role="tab" aria-selected={mode === "list"} className={mode === "list" ? styles.active : undefined} onClick={() => setMode("list")}>
            Elenco
          </button>
        </div>

        {mode === "topology" && (
          <span className={styles.meta}>
            {canvasIndex.length.toLocaleString("it-IT")} nodi
            {compressed.expandedCount > 0 && (
              <button type="button" className={styles.link} onClick={compressed.collapseAll}>
                Comprimi tutto
              </button>
            )}
          </span>
        )}

        {branchFilter && (
          <span className={styles.chip} title={branchFilter.map((f) => f.name).join(", ")}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
            </svg>
            Solo {describeFilter(branchFilter)}
            <button type="button" aria-label="Mostra tutti i branch" title="Mostra tutti i branch" onClick={() => setBranchFilter(null)}>
              ×
            </button>
          </span>
        )}

        <code className={`${styles.path} selectable`}>{repo.path}</code>
        <button
          type="button"
          className={`${styles.iconButton} ${searchOpen ? styles.active : ""}`}
          aria-label="Cerca nei commit"
          aria-pressed={searchOpen}
          title="Cerca nei commit (/)"
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </button>
        {mode !== "list" && (
          <button
            type="button"
            className={`${styles.iconButton} ${ancestors ? styles.active : ""}`}
            aria-label="Evidenzia gli antenati"
            aria-pressed={ancestors}
            title={ancestors ? "Smetti di evidenziare gli antenati (a)" : "Evidenzia gli antenati del commit selezionato (a)"}
            onClick={() => setAncestors((on) => !on)}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="6" r="2.5" />
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="6" cy="18" r="2.5" />
              <path d="M6 8.5v7M15.5 6h-7" />
            </svg>
          </button>
        )}
        {mode !== "list" && (
          <button
            type="button"
            className={`${styles.iconButton} ${flow ? styles.active : ""}`}
            aria-label="Flusso animato"
            aria-pressed={flow}
            title={flow ? "Disattiva i pallini animati sui collegamenti" : "Attiva i pallini animati sui collegamenti"}
            onClick={toggleFlow}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4M10 12h4" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        )}
        {mode !== "list" && mode !== "timeline" && (
          <button
            type="button"
            className={`${styles.iconButton} ${sea ? styles.active : ""}`}
            aria-label="Pesci sullo sfondo"
            aria-pressed={sea}
            title={sea ? "Nascondi i pesci sullo sfondo" : "Mostra i pesci sullo sfondo"}
            onClick={toggleSea}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12c-2.5 3.5-6 5-9.5 5S7 15 6 12c1-3 2.5-5 5.5-5s7 1.5 9.5 5z" />
              <path d="M6 12 2 8.5v7z" />
              <circle cx="16.5" cy="11" r="0.8" fill="currentColor" stroke="none" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${panelOpen ? styles.active : ""}`}
          aria-label="Pannello dettagli"
          aria-pressed={panelOpen}
          title="Pannello dettagli (Invio)"
          onClick={() => setPanelOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>
        <Button variant="ghost" onClick={onClose}>
          Chiudi
        </Button>
      </div>

      <div className={styles.body}>
        {/* The panel floats above the views, which keep their size: resizing it redraws nothing. */}
        <div
          className={`${styles.main} ${mode === "list" ? styles.reserve : ""}`}
          style={{ "--inset-right": `${insetRight}px` } as CSSProperties}
        >
          {mode === "timeline" ? (
            <TimelineCanvas
              ref={graphRef}
              index={index}
              version={stream.version}
              initialSelectedId={selected?.id ?? null}
              active={active}
              flow={flow}
              emphasis={emphasis}
              onSelect={selectCommit}
              insetRight={insetRight}
            />
          ) : mode !== "list" ? (
            <GraphCanvas
              ref={graphRef}
              index={canvasIndex}
              version={canvasVersion}
              initialSelectedId={selected?.id ?? null}
              active={active}
              flow={flow}
              emphasis={emphasis}
              onSelect={selectCommit}
              onExpandGroup={mode === "topology" ? compressed.expand : undefined}
              onCollapseGroup={mode === "topology" ? compressed.collapse : undefined}
              worktree={worktreeMarker}
              onOpenWorktree={openWorktree}
              insetRight={insetRight}
              sea={sea}
            />
          ) : (
            <CommitList commits={listCommits} selectedId={selected?.id ?? null} onSelect={selectCommit} />
          )}
          {searchOpen && (
            <SearchBar
              value={searchText}
              onChange={setSearchText}
              onClose={closeSearch}
              search={search}
              index={index}
              current={currentMatch}
              targets={targets.length}
              onStep={stepSearch}
              onPick={selectById}
              focusSignal={searchFocus}
            />
          )}
        </div>

        {drawer.mounted && (
          <div
            className={`${styles.panel} ${drawer.shown ? styles.shown : ""}`}
            style={{ width: panelWidth }}
            onTransitionEnd={drawer.onTransitionEnd}
            inert={!drawer.shown}
          >
            <div className={styles.resizer} onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Ridimensiona il pannello" />
            {showWorktree ? (
              <WorktreePanel
                sessionId={repo.sessionId}
                onSelectCommit={(id) => {
                  setShowWorktree(false);
                  selectById(id);
                }}
              />
            ) : (
              <DetailsPanel sessionId={repo.sessionId} commit={selected} index={index} onSelectCommit={selectById} />
            )}
          </div>
        )}
      </div>

      <LoadStatus stream={stream} selected={selected} fetch={remote.state} onFetchNow={remote.fetchNow} />
      </div>
    </div>
  );
}
