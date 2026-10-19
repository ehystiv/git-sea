import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { CiPanel } from "../ci/CiPanel";
import { buildCiMarkers, latestRun } from "../ci/markers";
import { openUrl, useCi } from "../ci/useCi";
import { CommitList } from "../commits/CommitList";
import { LoadStatus } from "../commits/LoadStatus";
import { useCommitStream } from "../commits/useCommitStream";
import { ContextMenu } from "../../components/ContextMenu/ContextMenu";
import { copyText } from "../../lib/clipboard";
import { ComparePanel } from "../details/ComparePanel";
import { commitDetailsQuery } from "../details/useCommitDetails";
import { DetailsPanel } from "../details/DetailsPanel";
import { useWorktreeStatus } from "../details/useWorktree";
import { WorktreePanel } from "../details/WorktreePanel";
import { ancestorEmphasis, ancestorMask, matchEmphasis, type Emphasis } from "../graph/emphasis";
import type { CiScene } from "../graph/ciDraw";
import type { WorktreeMarker } from "../graph/draw";
import { GraphCanvas, type GraphCanvasHandle } from "../graph/GraphCanvas";
import { divergence, divergenceEmphasis } from "../graph/range";
import { useCompressedIndex } from "../graph/useCompressedIndex";
import { usePalette, usePaletteSource } from "../palette/paletteStore";
import { stepMatch } from "../search/query";
import { SearchBar } from "../search/SearchBar";
import { useSearch } from "../search/useSearch";
import { TimelineCanvas } from "../timeline/TimelineCanvas";
import { describeFilter, pruneFilter, toggleRef } from "../sidebar/refFilter";
import { Sidebar } from "../sidebar/Sidebar";
import { useSidebarWidth } from "../sidebar/sidebarWidth";
import { branchDivergences, useUpstreams, type BranchDivergence } from "../sidebar/upstream";
import { useFlow } from "../../lib/flow";
import { useSea } from "../../lib/sea";
import { formatCount, shortHash, splitPath } from "../../lib/format";
import { blobToBase64 } from "../graph/snapshot";
import { commands } from "../../lib/bindings";
import { useT, type Messages } from "../../lib/i18n";
import { headCommitId } from "./head";
import { normalizePath } from "../../app/tabsLogic";
import { useBookmarks } from "../bookmarks/bookmarksStore";
import { commitMenuItems } from "./commitMenu";
import { emptyHistory, go, visit, type SelectionHistory } from "./history";
import { useRepoWeb } from "./useRepoWeb";
import { hasModKey, modShortcut } from "../../lib/platform";
import { useDrawer } from "./useDrawer";
import { useFetchStatus } from "./useFetchStatus";
import { useRepoChanges } from "./useRepoChanges";
import { useRepoCommands, type RepoCommandActions, type ViewMode } from "./useRepoCommands";
import type { CiProvider, CommitSummary, HeadInfo, RefFilter, RepoInfo } from "../../lib/bindings";
import styles from "./RepoView.module.css";

const NO_BOOKMARKS: readonly string[] = [];
const PANEL_MIN = 320;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 440;
/** Space around the floating details panel, as `--space-3` in RepoView.module.css. */
const PANEL_GAP = 12;

function describeHead(head: HeadInfo, m: Messages): { label: string; detail?: string } {
  switch (head.kind) {
    case "Branch":
      return { label: head.name, detail: shortHash(head.commit) };
    case "Detached":
      return { label: m.repo.detachedHead, detail: shortHash(head.commit) };
    case "Unborn":
      return { label: head.name, detail: m.repo.noCommits };
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
  const m = useT();
  const [branchFilter, setBranchFilter] = useState<RefFilter[] | null>(null);
  const stream = useCommitStream(repo.sessionId, branchFilter);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchFocus, setSearchFocus] = useState(0);
  const [ancestors, setAncestors] = useState(false);
  const [selected, setSelected] = useState<CommitSummary | null>(null);
  /** Two commits whose trees the panel compares; `base` is the older side. */
  const [compare, setCompare] = useState<{ base: string; target: string } | null>(null);
  /** A local branch whose divergence from its upstream is highlighted. */
  const [divergenceOf, setDivergenceOf] = useState<string | null>(null);
  /** The details panel shows the local changes instead of the selected commit. */
  const [showWorktree, setShowWorktree] = useState(false);
  /** The details panel shows the CI of this commit instead of its details. */
  const [ciCommit, setCiCommit] = useState<string | null>(null);
  /** The only workflow whose markers are shown, or null for all. */
  const [ciFocus, setCiFocus] = useState<number | null>(null);
  /** The CI service whose token field is open in the sidebar. */
  const [tokenFor, setTokenFor] = useState<CiProvider | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const sidebarCollapsed = useSidebarWidth((s) => s.collapsed);
  const toggleSidebar = useSidebarWidth((s) => s.toggleCollapsed);
  // Set in the same render as the change, so the transition is in place when the columns change.
  const [sidebarShown, setSidebarShown] = useState(sidebarCollapsed);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);
  if (sidebarShown !== sidebarCollapsed) {
    setSidebarShown(sidebarCollapsed);
    setSidebarAnimating(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const head = describeHead(repo.head, m);
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
      void queryClient.invalidateQueries({ queryKey: ["upstreams", repo.sessionId] });
    }, [reload, queryClient, repo.sessionId]),
  );

  // Ahead/behind of every local branch with an upstream, worked out on the loaded history.
  const upstreams = useUpstreams(repo.sessionId);
  const divergences = useMemo(() => branchDivergences(index, upstreams.data ?? []), [index, stream.version, upstreams.data]);
  const focusedDivergence = divergenceOf === null ? null : (divergences.get(divergenceOf) ?? null);
  const showDivergence = useCallback((d: BranchDivergence) => setDivergenceOf((current) => (current === d.branch ? null : d.branch)), []);

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
    setCiCommit(null);
    setPanelOpen(true);
  }, []);

  // CI: workflows in HEAD, runs from the services, and where both go on the graph.
  const ci = useCi(repo.sessionId, active);
  const ciRuns = ci.report?.runs;
  const ciMarkers = useMemo(() => buildCiMarkers(index, ci.overview, ciRuns ?? [], null), [index, stream.version, ci.overview, ciRuns]);
  const ciScene = useMemo((): CiScene | null => {
    if (!ci.overview || ci.overview.workflows.length === 0) return null;
    const markers = ciFocus === null ? ciMarkers : buildCiMarkers(index, ci.overview, ciRuns ?? [], ciFocus);
    return { markers, workflows: ci.overview.workflows };
  }, [ci.overview, ciMarkers, ciFocus, index, ciRuns]);
  // A workflow that is gone (HEAD changed) cannot stay focused.
  useEffect(() => {
    if (ciFocus !== null && !ci.overview?.workflows.some((w) => w.id === ciFocus)) setCiFocus(null);
  }, [ci.overview, ciFocus]);
  // Clicking a commit, even the selected one, brings its details back over the CI or local changes.
  const showCommitDetails = useCallback(() => {
    setShowWorktree(false);
    setCiCommit(null);
  }, []);
  const openCi = useCallback((id: string) => {
    setShowWorktree(false);
    setCiCommit(id);
    setPanelOpen(true);
  }, []);

  // ⇧-click: compare the clicked commit with the selected one, the older one being the base.
  const startCompare = useCallback(
    (otherId: string, withId: string | null = selectedIdRef.current) => {
      if (withId === null || withId === otherId) return;
      const a = index.indexOf(otherId);
      const b = index.indexOf(withId);
      if (a === null || b === null) return;
      // The base is the ancestor when one descends from the other, else the older by date (the
      // walk position says nothing about age across branches).
      const { ahead, behind } = divergence(index, a, b);
      const timeA = index.commits[a]?.time ?? 0;
      const timeB = index.commits[b]?.time ?? 0;
      const otherIsBase = ahead === 0 ? true : behind === 0 ? false : timeA !== timeB ? timeA < timeB : a > b;
      setCompare(otherIsBase ? { base: otherId, target: withId } : { base: withId, target: otherId });
      setShowWorktree(false);
      setCiCommit(null);
      setPanelOpen(true);
    },
    [index],
  );
  const compareWithCommit = useCallback((commit: CommitSummary) => startCompare(commit.id), [startCompare]);

  // Export of the visible view as an image, with a short notice of how it went.
  const [exportAt, setExportAt] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  const openExport = useCallback((x: number, y: number) => setExportAt({ x, y }), []);
  const savePng = useCallback(async () => {
    const blob = await graphRef.current?.snapshot();
    if (!blob) return setNotice(m.export.empty);
    const day = new Date().toISOString().slice(0, 10);
    const result = await commands.savePng(`${repo.name}-${mode}-${day}.png`, await blobToBase64(blob)).catch(() => null);
    if (result?.status !== "ok") return setNotice(m.export.failed);
    if (result.data) setNotice(m.export.saved(splitPath(result.data)[1]));
  }, [m, repo.name, mode]);
  const copyImage = useCallback(async () => {
    const snapshot = graphRef.current?.snapshot() ?? Promise.resolve(null);
    try {
      // Safari only allows writing during the click: the item takes the image still being drawn.
      const png = snapshot.then((blob) => {
        if (!blob) throw new Error("empty");
        return blob;
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setNotice(m.export.copied);
    } catch {
      setNotice((await snapshot) ? m.export.failed : m.export.empty);
    }
  }, [m]);

  // Bookmarks, kept per repository across launches.
  const repoKey = normalizePath(repo.path);
  const bookmarks = useBookmarks((s) => s.all[repoKey] ?? NO_BOOKMARKS);
  const toggleBookmark = useBookmarks((s) => s.toggle);
  const bookmarkSet = useMemo(() => new Set(bookmarks), [bookmarks]);
  const toggleBookmarkOf = useCallback((id: string) => toggleBookmark(repoKey, id), [toggleBookmark, repoKey]);

  // Right-click on a commit, in any view.
  const [menu, setMenu] = useState<{ commit: CommitSummary; x: number; y: number } | null>(null);
  const openMenu = useCallback((commit: CommitSummary, x: number, y: number) => setMenu({ commit, x, y }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const web = useRepoWeb(repo.sessionId).data ?? null;
  const copyMessage = useCallback(
    async (commit: CommitSummary) => {
      // The summary is only the first line; the body comes with the details (often already cached).
      const details = await queryClient.fetchQuery(commitDetailsQuery(repo.sessionId, commit.id)).catch(() => null);
      await copyText(details?.body ? `${details.summary}\n\n${details.body}` : commit.summary);
    },
    [queryClient, repo.sessionId],
  );
  const swapCompare = useCallback(() => setCompare((c) => (c ? { base: c.target, target: c.base } : null)), []);

  // Picking another commit brings its details back. Views report their selection again when they
  // are created, so only a different commit counts.
  const selectedIdRef = useRef<string | null>(null);
  // Back and forward through the selections; a selection made by going back is not recorded.
  const historyRef = useRef<SelectionHistory>(emptyHistory);
  // True while going back or forward: the views report the selection synchronously.
  const travelling = useRef(false);
  const [historyMoves, setHistoryMoves] = useState({ back: false, forward: false });
  const recordHistory = useCallback((next: SelectionHistory) => {
    historyRef.current = next;
    const back = next.at > 0;
    const forward = next.at < next.entries.length - 1;
    setHistoryMoves((moves) => (moves.back === back && moves.forward === forward ? moves : { back, forward }));
  }, []);
  // Moving with j, k, h or l is a step: it replaces the last entry instead of adding one, so back
  // returns to where the walk started. The views select synchronously while handling the key, so
  // a selection right after one of those keys came from it; clicks are always jumps.
  const stepKeyAt = useRef(-Infinity);
  useEffect(() => {
    let gAt = -Infinity;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const now = performance.now();
      // `g h` jumps to HEAD, as the views read it.
      if (event.key === "h" && now - gAt < 600) return;
      if (event.key === "g") gAt = now;
      else if (event.key === "j" || event.key === "k" || event.key === "h" || event.key === "l") stepKeyAt.current = now;
    };
    // Capture: before the views' own listeners on the window.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  const isStep = useCallback(() => performance.now() - stepKeyAt.current < 50, []);
  const selectCommit = useCallback(
    (commit: CommitSummary | null) => {
      if (commit && commit.id !== selectedIdRef.current) {
        setShowWorktree(false);
        setCiCommit(null);
        // Jumping between the two ends keeps the comparison; any other commit ends it.
        setCompare((c) => (c && (c.base === commit.id || c.target === commit.id) ? c : null));
        if (!travelling.current) recordHistory(visit(historyRef.current, commit.id, isStep));
      }
      selectedIdRef.current = commit?.id ?? null;
      setSelected(commit);
    },
    [isStep, recordHistory],
  );

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
  // The history of a file is a path search, so the search bar can step through it.
  const showFileHistory = useCallback(
    (path: string) => {
      setSearchText(`path:${path}`);
      openSearch();
    },
    [openSearch],
  );

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
      } else if (event.key === "b" && selectedIdRef.current !== null) {
        event.preventDefault();
        toggleBookmarkOf(selectedIdRef.current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, openSearch, toggleBookmarkOf]);

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

  const goHistory = useCallback(
    (step: -1 | 1) => {
      const next = go(historyRef.current, step, (id) => index.indexOf(id) !== null);
      const id = next?.entries[next.at];
      if (!next || id === undefined) return;
      recordHistory(next);
      travelling.current = true;
      try {
        selectById(id);
      } finally {
        travelling.current = false;
      }
    },
    [index, recordHistory, selectById],
  );

  // ⌘B shows or hides the sidebar. ⌘[ and ⌘] (Ctrl on Linux and Windows), and the mouse's back and forward buttons. The key code
  // is checked too, since on some layouts (Italian) the brackets need ⌥.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!hasModKey(event) || event.shiftKey || usePalette.getState().open) return;
      if (event.code === "KeyB" && !event.altKey) {
        event.preventDefault();
        useSidebarWidth.getState().toggleCollapsed();
        return;
      }
      const back = event.code === "BracketLeft" || event.key === "[";
      const forward = event.code === "BracketRight" || event.key === "]";
      if (!back && !forward) return;
      event.preventDefault();
      goHistory(back ? -1 : 1);
    }
    function onMouseUp(event: MouseEvent) {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      goHistory(event.button === 3 ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [active, goHistory]);

  // ---- search, ancestors and filter ------------------------------------------------------

  /** The index the current view draws: the compressed one in topology, else the full one. */
  const viewIndex = mode === "topology" ? compressed.index : index;
  const viewVersion = mode === "topology" ? compressed.version : stream.version;
  // With the ancestors on, a search looks only in the history of one commit: the one selected
  // when the search started or the ancestors were turned on. It stays put while stepping through
  // the results moves the selection.
  const searching = searchOpen && searchText.trim() !== "";
  const [anchorId, setAnchorId] = useState<string | null>(null);
  useEffect(() => {
    if (!searching) setAnchorId(selected?.id ?? null);
  }, [searching, selected]);
  useEffect(() => {
    if (ancestors) setAnchorId(selectedIdRef.current);
  }, [ancestors]);
  const scopeId = ancestors && searching ? anchorId : null;
  const scopeMask = useMemo(() => {
    const at = scopeId === null ? null : index.indexOf(scopeId);
    return at === null ? null : ancestorMask(index, at);
  }, [scopeId, index, stream.version]);
  const searchIds = useMemo(() => {
    const ids = searchOpen ? search.ids : null;
    if (!ids || !scopeMask) return ids;
    return ids.filter((id) => scopeMask[index.indexOf(id) ?? -1] === 1);
  }, [searchOpen, search.ids, scopeMask, index]);
  const scopedSearch = useMemo(() => ({ ...search, ids: searchIds }), [search, searchIds]);

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

  // A comparison, or else a highlighted branch divergence: the commits on either side only.
  const rangeEnds = compare ? ([compare.target, compare.base] as const) : focusedDivergence ? ([focusedDivergence.branchCommit, focusedDivergence.upstreamCommit] as const) : null;
  const rangeA = rangeEnds?.[0] ?? null;
  const rangeB = rangeEnds?.[1] ?? null;
  const range = useMemo(() => {
    if (rangeA === null || rangeB === null) return null;
    const a = index.indexOf(rangeA);
    const b = index.indexOf(rangeB);
    return a === null || b === null ? null : divergence(index, a, b);
  }, [index, stream.version, rangeA, rangeB]);

  const emphasis = useMemo((): Emphasis | null => {
    if (mode === "list") return null;
    // A scoped search keeps the commit it looks under lit, as a landmark.
    if (searchIds && searchIds.length > 0) return matchEmphasis(viewIndex, scopeMask && scopeId !== null ? [...searchIds, scopeId] : searchIds);
    if (range && rangeA !== null && rangeB !== null) {
      const lit = divergenceEmphasis(index, viewIndex, range, [rangeA, rangeB]);
      return mode === "timeline" ? { nodes: lit.nodes, edges: null, edgeStart: null } : lit;
    }
    if (!ancestors || selectedId === null) return null;
    const at = viewIndex.indexOf(selectedId);
    if (at === null) return null;
    // The timeline draws its own links between commits, so it only needs the commits.
    return mode === "timeline" ? { nodes: ancestorMask(viewIndex, at), edges: null, edgeStart: null } : ancestorEmphasis(viewIndex, at);
  }, [mode, searchIds, scopeMask, scopeId, range, rangeA, rangeB, index, ancestors, selectedId, viewIndex, viewVersion]);

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
    toggleSidebar,
    toggleFlow,
    toggleSea,
    toggleAncestors: () => setAncestors((on) => !on),
    compareWith: (id) => startCompare(id),
    swapCompare,
    stopCompare: () => setCompare(null),
    showDivergence: (branch) => setDivergenceOf(branch),
    stopDivergence: () => setDivergenceOf(null),
    toggleBookmark: () => {
      if (selectedIdRef.current !== null) toggleBookmarkOf(selectedIdRef.current);
    },
    exportPng: () => void savePng(),
    copyImage: () => void copyImage(),
    goBack: () => goHistory(-1),
    goForward: () => goHistory(1),
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
    focusWorkflow: setCiFocus,
    openUrl,
    refreshCi: ci.refreshRuns,
    askToken: setTokenFor,
  });
  const ciCommands = useMemo(() => {
    const workflows = ci.overview?.workflows ?? [];
    const latest = new Map<number, string>();
    for (const workflow of workflows) {
      const run = latestRun(ciRuns ?? [], workflow, workflows);
      if (run && index.indexOf(run.commit) !== null) latest.set(workflow.id, run.commit);
    }
    const providers = (ci.report?.providers ?? []).filter((p) => p.provider !== "Jenkins" && p.access.kind !== "unavailable").map((p) => p.provider);
    return { workflows, focus: ciFocus, latest, providers };
  }, [ci.overview, ci.report, ciRuns, ciFocus, index, stream.version]);
  usePaletteSource(
    `repo:${repo.sessionId}`,
    useRepoCommands(
      active,
      {
        index,
        version: stream.version,
        mode,
        panelOpen,
        sidebarCollapsed,
        flow,
        sea,
        ancestors,
        hasSelection: selected !== null,
        comparing: compare !== null,
        divergences,
        divergenceOf: focusedDivergence?.branch ?? null,
        bookmarks,
        selectionBookmarked: selected !== null && bookmarkSet.has(selected.id),
        canGoBack: historyMoves.back,
        canGoForward: historyMoves.forward,
        canCollapse: mode === "topology" && compressed.expandedCount > 0,
        branchFilter,
        ci: ciCommands,
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

  const compareCommits = useMemo(() => {
    if (!compare) return null;
    const base = index.commits[index.indexOf(compare.base) ?? -1];
    const target = index.commits[index.indexOf(compare.target) ?? -1];
    return base && target ? { base, target } : null;
  }, [compare, index, stream.version]);

  const insetRight = panelOpen ? panelWidth + PANEL_GAP * 2 : 0;
  const drawer = useDrawer(panelOpen);

  // The sidebar is resized from its right edge; a double click there gives the default back.
  const sidebarWidth = useSidebarWidth((s) => s.width);
  const setSidebarWidth = useSidebarWidth((s) => s.setWidth);
  const resetSidebarWidth = useSidebarWidth((s) => s.reset);
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const target = event.currentTarget;
    // From the width on screen, which a narrow window may keep below the chosen one.
    const startWidth = target.offsetLeft + target.offsetWidth / 2;
    target.setPointerCapture(event.pointerId);
    const onMove = (e: PointerEvent) => setSidebarWidth(startWidth + (e.clientX - startX));
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

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
    <div
      className={`${styles.view} ${sidebarCollapsed ? styles.sidebarCollapsed : ""} ${sidebarAnimating ? styles.sidebarAnimating : ""}`}
      style={{ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSidebarAnimating(false);
      }}
    >
      {!sidebarCollapsed && !sidebarAnimating && (
        <div
          className={styles.sidebarResizer}
          onPointerDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
          role="separator"
          aria-orientation="vertical"
          aria-label={m.repo.resizeSidebar}
          title={m.repo.resizeSidebarTitle}
        />
      )}
      <Sidebar
        sessionId={repo.sessionId}
        index={index}
        version={stream.version}
        selectedId={selected?.id ?? null}
        onSelectCommit={selectById}
        branchFilter={branchFilter}
        onToggleFilter={toggleFilter}
        ci={ci}
        ciFocus={ciFocus}
        onCiFocus={setCiFocus}
        tokenFor={tokenFor}
        onTokenFor={setTokenFor}
        divergences={divergences}
        onDivergence={showDivergence}
        bookmarks={bookmarks}
        onRemoveBookmark={toggleBookmarkOf}
        hidden={sidebarCollapsed}
      />

      <div className={styles.content}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.sidebarToggle}
          aria-pressed={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? m.commands.showSidebar : m.commands.hideSidebar}
          title={`${sidebarCollapsed ? m.commands.showSidebar : m.commands.hideSidebar} (${modShortcut("B")})`}
          onClick={toggleSidebar}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>
        <Badge color={0}>{head.label}</Badge>
        {head.detail && <code className={styles.detail}>{head.detail}</code>}
        <span className={styles.meta}>{m.repo.refs(formatCount(repo.refCount))}</span>
        {repo.isBare && <span className={styles.meta}>bare</span>}

        <div className={styles.seg} role="tablist" aria-label={m.repo.views}>
          <button type="button" role="tab" aria-selected={mode === "graph"} className={mode === "graph" ? styles.active : undefined} title={`${m.repo.graph} (1)`} onClick={() => setMode("graph")}>
            {m.repo.graph}
          </button>
          <button type="button" role="tab" aria-selected={mode === "topology"} className={mode === "topology" ? styles.active : undefined} title={`${m.repo.topology} (2)`} onClick={() => setMode("topology")}>
            {m.repo.topology}
          </button>
          <button type="button" role="tab" aria-selected={mode === "timeline"} className={mode === "timeline" ? styles.active : undefined} title={`${m.repo.timeline} (3)`} onClick={() => setMode("timeline")}>
            {m.repo.timeline}
          </button>
          <button type="button" role="tab" aria-selected={mode === "list"} className={mode === "list" ? styles.active : undefined} onClick={() => setMode("list")}>
            {m.repo.list}
          </button>
        </div>

        {mode === "topology" && (
          <span className={styles.meta}>
            {m.repo.nodes(formatCount(canvasIndex.length))}
            {compressed.expandedCount > 0 && (
              <button type="button" className={styles.link} onClick={compressed.collapseAll}>
                {m.repo.collapseAll}
              </button>
            )}
          </span>
        )}

        {branchFilter && (
          <span className={styles.chip} title={branchFilter.map((f) => f.name).join(", ")}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
            </svg>
            {m.repo.only(describeFilter(branchFilter, m))}
            <button type="button" aria-label={m.repo.showAllBranches} title={m.repo.showAllBranches} onClick={() => setBranchFilter(null)}>
              ×
            </button>
          </span>
        )}

        {focusedDivergence && (
          <span className={styles.chip} title={m.sidebar.divergence(focusedDivergence.ahead, focusedDivergence.behind, focusedDivergence.upstream)}>
            {m.repo.divergence(focusedDivergence.branch, focusedDivergence.upstream)}
            <span className={styles.counts}>
              {focusedDivergence.ahead}↑ {focusedDivergence.behind}↓
            </span>
            <button type="button" aria-label={m.repo.stopDivergence} title={m.repo.stopDivergence} onClick={() => setDivergenceOf(null)}>
              ×
            </button>
          </span>
        )}

        <code className={`${styles.path} selectable`}>{repo.path}</code>
        <button
          type="button"
          className={`${styles.iconButton} ${searchOpen ? styles.active : ""}`}
          aria-label={m.repo.search}
          aria-pressed={searchOpen}
          title={m.repo.searchTitle}
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
            aria-label={m.repo.ancestors}
            aria-pressed={ancestors}
            title={ancestors ? m.repo.ancestorsOff : m.repo.ancestorsOn}
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
            aria-label={m.repo.flow}
            aria-pressed={flow}
            title={flow ? m.repo.flowOff : m.repo.flowOn}
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
            aria-label={m.repo.sea}
            aria-pressed={sea}
            title={sea ? m.repo.seaHide : m.repo.seaShow}
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
          aria-label={m.repo.panel}
          aria-pressed={panelOpen}
          title={m.repo.panelTitle}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>
        <Button variant="ghost" onClick={onClose}>
          {m.repo.close}
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
              onCompare={compareWithCommit}
              onContextMenu={openMenu}
              onExport={openExport}
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
              onClickCommit={showCommitDetails}
              onCompare={compareWithCommit}
              onContextMenu={openMenu}
              onExpandGroup={mode === "topology" ? compressed.expand : undefined}
              onCollapseGroup={mode === "topology" ? compressed.collapse : undefined}
              worktree={worktreeMarker}
              bookmarks={bookmarkSet}
              onOpenWorktree={openWorktree}
              ci={ciScene}
              onOpenCi={openCi}
              insetRight={insetRight}
              sea={sea}
              onExport={openExport}
            />
          ) : (
            <CommitList commits={listCommits} selectedId={selected?.id ?? null} onSelect={selectCommit} onCompare={compareWithCommit} onContextMenu={openMenu} />
          )}
          {notice && (
            <div className={styles.notice} role="status">
              {notice}
            </div>
          )}
          {searchOpen && (
            <SearchBar
              value={searchText}
              onChange={setSearchText}
              onClose={closeSearch}
              search={scopedSearch}
              scope={scopeMask && scopeId !== null ? scopeId : null}
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
            <div className={styles.resizer} onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label={m.repo.resizePanel} />
            {showWorktree ? (
              <WorktreePanel
                sessionId={repo.sessionId}
                onSelectCommit={(id) => {
                  setShowWorktree(false);
                  selectById(id);
                }}
              />
            ) : ciCommit !== null ? (
              <CiPanel
                commit={index.commits[index.indexOf(ciCommit) ?? -1] ?? null}
                marker={ciMarkers.get(ciCommit) ?? null}
                ci={ci}
                onShowCommit={() => setCiCommit(null)}
              />
            ) : compareCommits ? (
              <ComparePanel
                sessionId={repo.sessionId}
                base={compareCommits.base}
                target={compareCommits.target}
                counts={range && compare ? { onlyTarget: range.ahead, onlyBase: range.behind } : null}
                onSelectCommit={selectById}
                onSwap={swapCompare}
                onClose={() => setCompare(null)}
                onFileHistory={showFileHistory}
              />
            ) : (
              <DetailsPanel sessionId={repo.sessionId} commit={selected} index={index} onSelectCommit={selectById} onFileHistory={showFileHistory} />
            )}
          </div>
        )}
      </div>

      {exportAt && (
        <ContextMenu
          x={exportAt.x}
          y={exportAt.y}
          label={m.export.label}
          placement="above"
          onClose={() => setExportAt(null)}
          items={[
            { id: "save", label: m.export.save, run: () => void savePng() },
            { id: "copy", label: m.export.copy, run: () => void copyImage() },
          ]}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={m.menu.label}
          onClose={closeMenu}
          items={commitMenuItems(menu.commit, selected?.id ?? null, web, bookmarkSet.has(menu.commit.id), {
            copy: (text) => void copyText(text),
            copyMessage: (commit) => void copyMessage(commit),
            compare: compareWithCommit,
            toggleBookmark: (commit) => toggleBookmarkOf(commit.id),
            openUrl,
          })}
        />
      )}

      <LoadStatus stream={stream} selected={selected} fetch={remote.state} onFetchNow={remote.fetchNow} />
      </div>
    </div>
  );
}
