import { useMemo } from "react";
import type { CiProvider, CiWorkflow, RefFilter, RefLabel } from "../../lib/bindings";
import { PROVIDER_LABEL } from "../ci/labels";
import { shortHash } from "../../lib/format";
import type { GraphIndex } from "../graph/GraphIndex";
import type { PaletteSource } from "../palette/paletteStore";
import type { PaletteCommand } from "../palette/rank";
import { matchCommits } from "../search/query";
import { inFilter } from "../sidebar/refFilter";

export type ViewMode = "graph" | "topology" | "timeline" | "list";

const VIEWS: Array<{ mode: ViewMode; title: string; shortcut?: string; keywords: string }> = [
  { mode: "graph", title: "Vista grafo", shortcut: "1", keywords: "graph nodi canvas" },
  { mode: "topology", title: "Vista topologia compressa", shortcut: "2", keywords: "topology compressa catene" },
  { mode: "timeline", title: "Vista timeline", shortcut: "3", keywords: "timeline tempo date" },
  { mode: "list", title: "Vista elenco", keywords: "list lista tabella" },
];

const KIND_LABEL: Record<RefLabel["kind"], string> = { Head: "branch (HEAD)", Branch: "branch", Remote: "remote", Tag: "tag" };
const MAX_REFS = 10;
const MAX_FILTER_REFS = 5;
const MAX_COMMITS = 8;

export interface RepoCommandState {
  index: GraphIndex;
  /** Changes whenever `index` gets new data. */
  version: number;
  mode: ViewMode;
  panelOpen: boolean;
  flow: boolean;
  sea: boolean;
  ancestors: boolean;
  hasSelection: boolean;
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
  toggleFlow: () => void;
  toggleSea: () => void;
  toggleAncestors: () => void;
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
  const { index, version, mode, panelOpen, flow, sea, ancestors, hasSelection, canCollapse, branchFilter, ci } = state;

  return useMemo(() => {
    if (!active) return null;
    const commands: PaletteCommand[] = [];
    const add = (command: Omit<PaletteCommand, "group">, group: string) => commands.push({ ...command, group });

    for (const view of VIEWS) {
      if (view.mode === mode) continue;
      add({ id: `view:${view.mode}`, title: view.title, shortcut: view.shortcut, keywords: view.keywords, run: () => actions.setMode(view.mode) }, "Vista");
    }
    add({ id: "panel", title: panelOpen ? "Nascondi il pannello dettagli" : "Mostra il pannello dettagli", shortcut: "↩", keywords: "details dettagli diff", run: actions.togglePanel }, "Vista");
    if (mode !== "list") {
      add({ id: "flow", title: flow ? "Ferma il flusso animato" : "Attiva il flusso animato", keywords: "pallini animazione flow", run: actions.toggleFlow }, "Vista");
      if (mode !== "timeline") {
        add({ id: "sea", title: sea ? "Nascondi i pesci sullo sfondo" : "Mostra i pesci sullo sfondo", keywords: "pesci mare sfondo fish acquario", run: actions.toggleSea }, "Vista");
      }
      add({ id: "fit", title: "Mostra tutta la storia", shortcut: "⌘0", keywords: "zoom adatta fit", run: actions.fit }, "Vista");
      add({ id: "zoom-in", title: "Ingrandisci", shortcut: "⌘+", keywords: "zoom in", run: actions.zoomIn }, "Vista");
      add({ id: "zoom-out", title: "Riduci", shortcut: "⌘−", keywords: "zoom out", run: actions.zoomOut }, "Vista");
    }
    if (canCollapse) add({ id: "collapse", title: "Richiudi tutte le catene", keywords: "comprimi topologia", run: actions.collapseAll }, "Vista");

    add({ id: "search", title: "Cerca nei commit", shortcut: "/", keywords: "trova find messaggio autore hash percorso file", run: actions.openSearch }, "Navigazione");
    add({ id: "head", title: "Vai a HEAD", shortcut: "g h", keywords: "head corrente", run: actions.goHead }, "Navigazione");
    if (hasSelection || ancestors) {
      add(
        {
          id: "ancestors",
          title: ancestors ? "Smetti di evidenziare gli antenati" : "Evidenzia gli antenati del commit selezionato",
          shortcut: "a",
          keywords: "storia parent ancestors highlight",
          run: actions.toggleAncestors,
        },
        "Navigazione",
      );
    }
    if (ci.focus !== null) add({ id: "ci:all", title: "Mostra tutti i workflow", keywords: "ci workflow azioni pipeline", run: () => actions.focusWorkflow(null) }, "CI");
    for (const workflow of ci.workflows) {
      const keywords = `ci workflow pipeline ${workflow.path} ${PROVIDER_LABEL[workflow.provider]}`;
      if (ci.focus !== workflow.id) {
        add({ id: `ci:focus:${workflow.id}`, title: `Mostra solo il workflow ${workflow.name}`, detail: PROVIDER_LABEL[workflow.provider], keywords, run: () => actions.focusWorkflow(workflow.id) }, "CI");
      }
      const latest = ci.latest.get(workflow.id);
      if (latest) add({ id: `ci:latest:${workflow.id}`, title: `Vai all'ultima run di ${workflow.name}`, keywords, run: () => actions.selectCommit(latest) }, "CI");
      const url = workflow.webUrl;
      if (url) add({ id: `ci:web:${workflow.id}`, title: `Apri ${workflow.name} nel browser`, detail: PROVIDER_LABEL[workflow.provider], keywords, run: () => actions.openUrl(url) }, "CI");
    }
    if (ci.workflows.length > 0) add({ id: "ci:refresh", title: "Aggiorna lo stato della CI", keywords: "ci run workflow ricarica", run: actions.refreshCi }, "CI");
    for (const provider of ci.providers) {
      add({ id: `ci:token:${provider}`, title: `Imposta il token di ${PROVIDER_LABEL[provider]}`, keywords: "ci token portachiavi accesso api", run: () => actions.askToken(provider) }, "CI");
    }
    if (branchFilter) add({ id: "filter:clear", title: "Mostra tutti i branch", keywords: "filtro togli rimuovi", run: actions.clearFilter }, "Filtro");

    const labels = [...index.refs.values()].flat();
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
        out.push({ id: `ref:${ref.kind}:${ref.name}`, group: "Riferimenti", title: `Vai a ${ref.name}`, detail: KIND_LABEL[ref.kind], run: () => actions.selectCommit(ref.commit) });
      }
      for (const ref of refs.filter((r) => r.name !== "HEAD").slice(0, MAX_FILTER_REFS)) {
        const filtered = inFilter(branchFilter, ref);
        const filter = { kind: ref.kind, name: ref.name };
        out.push({ id: `only:${ref.kind}:${ref.name}`, group: "Filtro", title: `Mostra solo ${ref.name}`, detail: KIND_LABEL[ref.kind], run: () => actions.showOnly(filter) });
        if (branchFilter && !filtered) out.push({ id: `add:${ref.kind}:${ref.name}`, group: "Filtro", title: `Aggiungi ${ref.name} al filtro`, run: () => actions.toggleFilter(filter) });
        if (filtered) out.push({ id: `drop:${ref.kind}:${ref.name}`, group: "Filtro", title: `Togli ${ref.name} dal filtro`, run: () => actions.toggleFilter(filter) });
      }
      if (needle.length >= 2) {
        for (const id of matchCommits(index.commits, { mode: "text", text: needle }, MAX_COMMITS)) {
          const commit = index.commits[index.indexOf(id) ?? -1];
          if (!commit) continue;
          out.push({ id: `commit:${id}`, group: "Commit", title: commit.summary || "(senza messaggio)", detail: `${shortHash(id)} · ${commit.author}`, run: () => actions.selectCommit(id) });
        }
      }
      return out;
    };

    return { commands, search };
    // `version` is what tells us the (mutable) index changed.
  }, [active, index, version, mode, panelOpen, flow, sea, ancestors, hasSelection, canCollapse, branchFilter, ci, actions]);
}
