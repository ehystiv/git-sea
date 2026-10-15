// Development only. The tab bar and the sidebar, fed by a graph dump and a fake `list_stashes`.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/tokens.css";
import "../styles/global.css";
import { addTab, emptyTabs } from "../app/tabsLogic";
import { TitleBar } from "../app/TitleBar";
import { GraphIndex } from "../features/graph/GraphIndex";
import { Sidebar } from "../features/sidebar/Sidebar";
import type { CommitSummary, GraphRow, RefLabel, RepoInfo } from "../lib/bindings";

interface Dump {
  commits: CommitSummary[];
  rows: GraphRow[];
  refs: RefLabel[];
}

const dump = (await (await fetch("/dev-data/merges.json")).json()) as Dump;
const index = new GraphIndex();
index.appendChunk(dump.commits, dump.rows);
index.setRefs(dump.refs);

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (command: string) => {
    if (command === "list_stashes") {
      const base = dump.commits[dump.commits.length - 1]?.id ?? null;
      return [
        { index: 0, message: "On main: half-done search", commit: "x1", base },
        { index: 1, message: "WIP on feature: 3a1f0c2 add login", commit: "x2", base },
      ];
    }
    throw new Error(`unexpected command ${command}`);
  },
};

const repo = (n: number, name: string): RepoInfo => ({
  sessionId: `s${n}`,
  name,
  path: `/Users/me/${name}`,
  head: { kind: "Unborn", name: "main" },
  refCount: 0,
  isBare: false,
});
const tabs = [repo(1, "branchscope"), repo(2, "linux-kernel"), repo(3, "a-very-long-repository-name-here")].reduce(addTab, emptyTabs);
const selected = dump.refs.find((r) => r.name === "feature")?.commit ?? null;

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ display: "grid", gridTemplateRows: "44px 1fr", height: "100%" }}>
        <TitleBar tabs={tabs.tabs} activeId="s2" onActivate={() => undefined} onClose={() => undefined} onNew={() => undefined} />
        <div style={{ display: "grid", gridTemplateColumns: "232px 1fr", minHeight: 0 }}>
          <Sidebar sessionId="s2" index={index} version={1} selectedId={selected} onSelectCommit={() => undefined} />
          <div style={{ background: "var(--surface)" }} />
        </div>
      </div>
    </QueryClientProvider>
  </StrictMode>,
);
