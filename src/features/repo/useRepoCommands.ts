import { useMemo } from "react";
import type { CiProvider, CiWorkflow, RefFilter, RefLabel } from "../../lib/bindings";
import { PROVIDER_LABEL } from "../ci/labels";
import { shortHash } from "../../lib/format";
import { useT, type Messages } from "../../lib/i18n";
import { modShortcut } from "../../lib/platform";
import type { GraphIndex } from "../graph/GraphIndex";
import type { PaletteSource } from "../palette/paletteStore";
import type { PaletteCommand } from "../palette/rank";
import { matchCommits, textQuery } from "../search/query";
import { inFilter } from "../sidebar/refFilter";
import type { BranchDivergence } from "../sidebar/upstream";

export type ViewMode = "graph" | "topology" | "timeline" | "list" | "stats";

/** The views drawn on a canvas, with zoom, export and the highlights. */
export function isCanvasMode(mode: ViewMode): boolean {
  return mode !== "list" && mode !== "stats";
}

const views = (m: Messages): Array<{ mode: ViewMode; title: string; shortcut?: string; keywords: string }> => [
  { mode: "graph", title: m.commands.viewGraph, shortcut: "1", keywords: "graph grafo nodi canvas" },
  { mode: "topology", title: m.commands.viewTopology, shortcut: "2", keywords: "topology topologia compressa catene" },
  { mode: "timeline", title: m.commands.viewTimeline, shortcut: "3", keywords: "timeline tempo date" },
  { mode: "list", title: m.commands.viewList, keywords: "list lista elenco tabella" },
  { mode: "stats", title: m.commands.viewStats, shortcut: "4", keywords: "statistiche statistics stats autori authors heatmap calendario calendar attività activity contributori contributors" },
];

const kindLabel = (m: Messages, kind: RefLabel["kind"]): string => m.commands.kind[kind];
const MAX_REFS = 10;
const MAX_FILTER_REFS = 5;
const MAX_COMMITS = 8;

export interface RepoCommandState {
  index: GraphIndex;
  /** Changes whenever `index` gets new data. */
  version: number;
  mode: ViewMode;
  /** Null where the view has no details panel. */
  panelOpen: boolean | null;
  sidebarCollapsed: boolean;
  flow: boolean;
  sea: boolean;
  ancestors: boolean;
  hasSelection: boolean;
  /** The panel compares two commits. */
  comparing: boolean;
  /** The panel shows the files of the selected commit. */
  browsing: boolean;
  /** Local branches and how far they are from their upstream, by branch name. */
  divergences: Map<string, BranchDivergence>;
  /** The branch whose divergence is highlighted. */
  divergenceOf: string | null;
  /** Bookmarked commit ids, latest first. */
  bookmarks: readonly string[];
  selectionBookmarked: boolean;
  /** There is a selection to go back or forward to. */
  canGoBack: boolean;
  canGoForward: boolean;
  canCollapse: boolean;
  branchFilter: RefFilter[] | null;
  ci: {
    workflows: CiWorkflow[];
    focus: number | null;
    /** Workflow id -> commit of its latest run, when that commit is loaded. */
    latest: Map<number, string>;
    /** Services a token can be saved for. */
    providers: CiProvider[];
  };
}

export interface RepoCommandActions {
  setMode: (mode: ViewMode) => void;
  togglePanel: () => void;
  toggleSidebar: () => void;
  toggleFlow: () => void;
  toggleSea: () => void;
  toggleAncestors: () => void;
  /** Compares the selected commit with this one. */
  compareWith: (id: string) => void;
  swapCompare: () => void;
  stopCompare: () => void;
  browseFiles: () => void;
  closeFiles: () => void;
  showDivergence: (branch: string) => void;
  stopDivergence: () => void;
  toggleBookmark: () => void;
  exportPng: () => void;
  copyImage: () => void;
  openReplay: () => void;
  goBack: () => void;
  goForward: () => void;
  openSearch: () => void;
  goHead: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  collapseAll: () => void;
  selectCommit: (id: string) => void;
  toggleFilter: (ref: RefFilter) => void;
  showOnly: (ref: RefFilter) => void;
  clearFilter: () => void;
  focusWorkflow: (id: number | null) => void;
  openUrl: (url: string) => void;
  refreshCi: () => void;
  askToken: (provider: CiProvider) => void;
}

/** What the active repository offers to the command palette. Null for a tab in the background. */
export function useRepoCommands(active: boolean, state: RepoCommandState, actions: RepoCommandActions): PaletteSource | null {
  const { index, version, mode, panelOpen, sidebarCollapsed, flow, sea, ancestors, hasSelection, comparing, browsing, divergences, divergenceOf, bookmarks, selectionBookmarked, canGoBack, canGoForward, canCollapse, branchFilter, ci } = state;
  const m = useT();

  return useMemo(() => {
    if (!active) return null;
    const commands: PaletteCommand[] = [];
    const add = (command: Omit<PaletteCommand, "group">, group: string) => commands.push({ ...command, group });
    const g = m.palette.groups;

    for (const view of views(m)) {
      if (view.mode === mode) continue;
      add({ id: `view:${view.mode}`, title: view.title, shortcut: view.shortcut, keywords: view.keywords, run: () => actions.setMode(view.mode) }, g.view);
    }
    if (panelOpen !== null) {
      add({ id: "panel", title: panelOpen ? m.commands.hidePanel : m.commands.showPanel, shortcut: "↩", keywords: "details dettagli diff", run: actions.togglePanel }, g.view);
    }
    add({ id: "sidebar", title: sidebarCollapsed ? m.commands.showSidebar : m.commands.hideSidebar, shortcut: modShortcut("B"), keywords: "sidebar barra laterale branch rami collassa collapse", run: actions.toggleSidebar }, g.view);
    if (isCanvasMode(mode)) {
      add({ id: "flow", title: flow ? m.commands.stopFlow : m.commands.startFlow, keywords: "pallini animazione flow dots", run: actions.toggleFlow }, g.view);
      if (mode !== "timeline") {
        add({ id: "sea", title: sea ? m.commands.hideSea : m.commands.showSea, keywords: "pesci mare sfondo fish sea acquario", run: actions.toggleSea }, g.view);
      }
      add({ id: "export:png", title: m.commands.exportPng, keywords: "esporta export png immagine image salva save screenshot", run: actions.exportPng }, g.view);
      add({ id: "export:copy", title: m.commands.copyImage, keywords: "copia copy immagine image appunti clipboard screenshot", run: actions.copyImage }, g.view);
      if (mode === "graph" || mode === "topology") {
        add({ id: "export:replay", title: m.replay.open, keywords: "replay storia history video gif registra record animazione animation", run: actions.openReplay }, g.view);
      }
      add({ id: "fit", title: m.commands.fit, shortcut: modShortcut("0"), keywords: "zoom adatta fit", run: actions.fit }, g.view);
      add({ id: "zoom-in", title: m.commands.zoomIn, shortcut: modShortcut("+"), keywords: "zoom in ingrandisci", run: actions.zoomIn }, g.view);
      add({ id: "zoom-out", title: m.commands.zoomOut, shortcut: modShortcut("−"), keywords: "zoom out riduci", run: actions.zoomOut }, g.view);
    }
    if (canCollapse) add({ id: "collapse", title: m.commands.collapseChains, keywords: "comprimi topologia collapse topology", run: actions.collapseAll }, g.view);

    add({ id: "search", title: m.commands.search, shortcut: "/", keywords: "trova find search messaggio message autore author hash percorso path file", run: actions.openSearch }, g.navigation);
    if (canGoBack) add({ id: "back", title: m.commands.back, shortcut: modShortcut("["), keywords: "indietro back history cronologia precedente", run: actions.goBack }, g.navigation);
    if (canGoForward) add({ id: "forward", title: m.commands.forward, shortcut: modShortcut("]"), keywords: "avanti forward history cronologia successivo", run: actions.goForward }, g.navigation);
    if (hasSelection) {
      add({ id: "bookmark", title: selectionBookmarked ? m.commands.removeBookmark : m.commands.addBookmark, shortcut: "b", keywords: "segnalibro bookmark preferito pin", run: actions.toggleBookmark }, g.navigation);
    }
    for (const id of bookmarks) {
      const commit = index.commits[index.indexOf(id) ?? -1];
      if (!commit) continue;
      add({ id: `bookmark:${id}`, title: m.commands.goToBookmark(commit.summary || shortHash(id)), detail: shortHash(id), keywords: "segnalibro bookmark vai go", run: () => actions.selectCommit(id) }, g.navigation);
    }
    add({ id: "head", title: m.commands.goHead, shortcut: "g h", keywords: "head corrente current", run: actions.goHead }, g.navigation);
    if (hasSelection || ancestors) {
      add(
        {
          id: "ancestors",
          title: ancestors ? m.commands.stopAncestors : m.commands.highlightAncestors,
          shortcut: "a",
          keywords: "storia parent ancestors highlight",
          run: actions.toggleAncestors,
        },
        g.navigation,
      );
    }
    const labels = [...index.refs.values()].flat();
    const head = labels.find((l) => l.kind === "Head");
    if (hasSelection && head && index.indexOf(head.commit) !== null) {
      add({ id: "compare:head", title: m.commands.compareWithHead, keywords: "compare confronta diff differenze head", run: () => actions.compareWith(head.commit) }, g.navigation);
    }
    if (browsing) add({ id: "files:close", title: m.commands.closeFiles, keywords: "file files albero tree chiudi close", run: actions.closeFiles }, g.navigation);
    else if (hasSelection && panelOpen !== null) {
      add({ id: "files:browse", title: m.commands.browseFiles, keywords: "file files albero tree sfoglia browse sorgente source contenuto content cartelle folders", run: actions.browseFiles }, g.navigation);
    }
    if (comparing) {
      add({ id: "compare:swap", title: m.commands.swapCompare, keywords: "compare confronta inverti swap", run: actions.swapCompare }, g.navigation);
      add({ id: "compare:stop", title: m.commands.stopCompare, keywords: "compare confronta chiudi close", run: actions.stopCompare }, g.navigation);
    }
    if (divergenceOf !== null) add({ id: "divergence:stop", title: m.commands.stopDivergence, keywords: "ahead behind upstream divergenza", run: actions.stopDivergence }, g.navigation);
    for (const d of divergences.values()) {
      if (d.branch === divergenceOf || (d.ahead === 0 && d.behind === 0)) continue;
      add(
        { id: `divergence:${d.branch}`, title: m.commands.highlightDivergence(d.branch, d.upstream), detail: `${d.ahead}↑ ${d.behind}↓`, keywords: "ahead behind upstream divergenza avanti indietro", run: () => actions.showDivergence(d.branch) },
        g.navigation,
      );
    }
    if (ci.focus !== null) add({ id: "ci:all", title: m.commands.showAllWorkflows, keywords: "ci workflow azioni actions pipeline", run: () => actions.focusWorkflow(null) }, g.ci);
    for (const workflow of ci.workflows) {
      const keywords = `ci workflow pipeline ${workflow.path} ${PROVIDER_LABEL[workflow.provider]}`;
      if (ci.focus !== workflow.id) {
        add({ id: `ci:focus:${workflow.id}`, title: m.commands.onlyWorkflow(workflow.name), detail: PROVIDER_LABEL[workflow.provider], keywords, run: () => actions.focusWorkflow(workflow.id) }, g.ci);
      }
      const latest = ci.latest.get(workflow.id);
      if (latest) add({ id: `ci:latest:${workflow.id}`, title: m.commands.latestRun(workflow.name), keywords, run: () => actions.selectCommit(latest) }, g.ci);
      const url = workflow.webUrl;
      if (url) add({ id: `ci:web:${workflow.id}`, title: m.commands.openInBrowser(workflow.name), detail: PROVIDER_LABEL[workflow.provider], keywords, run: () => actions.openUrl(url) }, g.ci);
    }
    if (ci.workflows.length > 0) add({ id: "ci:refresh", title: m.commands.refreshCi, keywords: "ci run workflow ricarica refresh", run: actions.refreshCi }, g.ci);
    for (const provider of ci.providers) {
      add({ id: `ci:token:${provider}`, title: m.commands.setToken(PROVIDER_LABEL[provider]), keywords: "ci token portachiavi keychain accesso access api", run: () => actions.askToken(provider) }, g.ci);
    }
    if (branchFilter) add({ id: "filter:clear", title: m.commands.showAllBranches, keywords: "filtro filter togli rimuovi clear", run: actions.clearFilter }, g.filter);

    const search = (query: string): PaletteCommand[] => {
      const needle = query.trim().toLowerCase();
      if (needle === "") return [];
      const refs = labels.filter((l) => l.name.toLowerCase().includes(needle));
      // Names starting with the text first, then the shorter ones.
      refs.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || a.name.length - b.name.length);
      const out: PaletteCommand[] = [];
      for (const ref of refs.slice(0, MAX_REFS)) {
        const loaded = index.indexOf(ref.commit) !== null;
        if (!loaded) continue;
        out.push({ id: `ref:${ref.kind}:${ref.name}`, group: g.refs, title: m.commands.goTo(ref.name), detail: kindLabel(m, ref.kind), run: () => actions.selectCommit(ref.commit) });
        if (hasSelection) out.push({ id: `compare:${ref.kind}:${ref.name}`, group: g.refs, title: m.commands.compareWith(ref.name), detail: kindLabel(m, ref.kind), run: () => actions.compareWith(ref.commit) });
      }
      for (const ref of refs.filter((r) => r.name !== "HEAD").slice(0, MAX_FILTER_REFS)) {
        const filtered = inFilter(branchFilter, ref);
        const filter = { kind: ref.kind, name: ref.name };
        out.push({ id: `only:${ref.kind}:${ref.name}`, group: g.filter, title: m.commands.showOnly(ref.name), detail: kindLabel(m, ref.kind), run: () => actions.showOnly(filter) });
        if (branchFilter && !filtered) out.push({ id: `add:${ref.kind}:${ref.name}`, group: g.filter, title: m.commands.addToFilter(ref.name), run: () => actions.toggleFilter(filter) });
        if (filtered) out.push({ id: `drop:${ref.kind}:${ref.name}`, group: g.filter, title: m.commands.removeFromFilter(ref.name), run: () => actions.toggleFilter(filter) });
      }
      if (needle.length >= 2) {
        for (const id of matchCommits(index.commits, textQuery(needle), MAX_COMMITS)) {
          const commit = index.commits[index.indexOf(id) ?? -1];
          if (!commit) continue;
          out.push({ id: `commit:${id}`, group: g.commit, title: commit.summary || m.commands.noMessage, detail: `${shortHash(id)} · ${commit.author}`, run: () => actions.selectCommit(id) });
        }
      }
      return out;
    };

    return { commands, search };
    // `version` is what tells us the (mutable) index changed.
  }, [m, active, index, version, mode, panelOpen, sidebarCollapsed, flow, sea, ancestors, hasSelection, comparing, browsing, divergences, divergenceOf, bookmarks, selectionBookmarked, canGoBack, canGoForward, canCollapse, branchFilter, ci, actions]);
}
