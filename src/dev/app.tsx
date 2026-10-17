// Development only. The whole app in a plain browser, on a fake backend that serves a graph dump
// from public/dev-data (`?data=<name>`, default merges). Searches and the branch filter are
// approximated: a path search matches subjects, and a filtered graph keeps the full layout.
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/tokens.css";
import "../styles/global.css";
import { App } from "../app/App";
import { useTabs } from "../app/tabsStore";
import { initLanguage } from "../lib/i18n";
import { initTheme } from "../lib/theme";
import type { CiOverview, CiRun, CiRunsReport, CommitSummary, GraphRow, LoadEvent, RefFilter, RefLabel } from "../lib/bindings";

interface Dump {
  commits: CommitSummary[];
  rows: GraphRow[];
  refs: RefLabel[];
}

const name = new URLSearchParams(location.search).get("data") ?? "merges";
const dump = (await (await fetch(`/dev-data/${name}.json`)).json()) as Dump;
const callbacks = new Map<number, (message: unknown) => void>();
let nextCallback = 1;

/** Commits reachable from the refs of the filter, in walk order. */
function reachable(only: RefFilter[]): Set<number> {
  const position = new Map(dump.commits.map((c, i) => [c.id, i]));
  const local = (k: string) => k === "Head" || k === "Branch";
  const stack = dump.refs
    .filter((r) => only.some((f) => f.name === r.name && (f.kind === r.kind || (local(f.kind) && local(r.kind)))))
    .flatMap((r) => position.get(r.commit) ?? []);
  const seen = new Set<number>(stack);
  while (stack.length > 0) {
    for (const parent of dump.commits[stack.pop() ?? 0]?.parents ?? []) {
      const p = position.get(parent);
      if (p !== undefined && !seen.has(p)) {
        seen.add(p);
        stack.push(p);
      }
    }
  }
  return seen;
}

function load(args: { only: RefFilter[] | null; onEvent: { id: number } }): null {
  const send = callbacks.get(args.onEvent.id);
  if (!send) return null;
  const keep = args.only ? reachable(args.only) : null;
  const commits = dump.commits.filter((_, i) => !keep || keep.has(i));
  const rows = dump.rows.filter((_, i) => !keep || keep.has(i));
  const events: LoadEvent[] = [{ event: "refs", data: { refs: dump.refs } }];
  for (let i = 0; i < commits.length; i += 2000) {
    events.push({ event: "chunk", data: { commits: commits.slice(i, i + 2000), rows: rows.slice(i, i + 2000) } });
  }
  events.push({ event: "done", data: { total: commits.length, setupMs: 0, firstChunkMs: 0, totalMs: 0, maxLanes: 0, fromCache: false } });
  events.forEach((message, index) => setTimeout(() => send({ index, message }), 10 * index));
  return null;
}

/** A made-up CI: "CI" on pushes and pull requests to main, "Release" on v* tags, runs along main. */
function fakeCi(): { overview: CiOverview; runs: CiRunsReport } {
  const branchName = (r: RefLabel) => (r.kind === "Remote" ? r.name.replace(/^[^/]+\//, "") : r.name);
  const main = dump.refs.find((r) => r.kind === "Head") ?? dump.refs[0];
  const mainName = main ? branchName(main) : "main";
  const overview: CiOverview = {
    workflows: [
      { id: 0, provider: "GitHub", name: "CI", path: ".github/workflows/ci.yml", events: ["push", "pull_request"], approximate: false, webUrl: "https://github.com/example/repo/actions/workflows/ci.yml" },
      { id: 1, provider: "GitHub", name: "Release", path: ".github/workflows/release.yml", events: ["push"], approximate: false, webUrl: null },
      { id: 2, provider: "CircleCi", name: "nightly", path: ".circleci/config.yml", events: ["schedule"], approximate: true, webUrl: null },
    ],
    push: dump.refs.flatMap((r) => {
      const workflows = r.kind === "Tag" ? [1] : branchName(r) === mainName ? [0] : [];
      return workflows.length > 0 ? [{ kind: r.kind, name: r.name, branch: branchName(r), commit: r.commit, workflows }] : [];
    }),
    mergeTargets: dump.refs.filter((r) => r.kind !== "Tag" && branchName(r) === mainName).map((r) => ({ kind: r.kind, name: r.name, branch: mainName, commit: r.commit, workflows: [0] })),
    problems: [{ path: ".travis.yml", message: "did not find expected node content" }],
    defaultBranch: mainName,
  };
  // Runs on main's first parents, newest first, with a mix of outcomes.
  const position = new Map(dump.commits.map((c, i) => [c.id, i]));
  const statuses: CiRun["status"][] = ["Running", "Success", "Failure", "Success", "Cancelled", "Success", "Queued", "Success"];
  const runs: CiRun[] = [];
  let at = main ? position.get(main.commit) : undefined;
  for (let n = 0; at !== undefined && n < statuses.length; n++) {
    const commit = dump.commits[at];
    if (!commit) break;
    runs.push({ provider: "GitHub", workflow: "CI", path: ".github/workflows/ci.yml", commit: commit.id, branch: mainName, event: "push", status: statuses[n] ?? "Success", url: "https://github.com/example/repo/actions/runs/1", created: new Date(Date.now() - n * 3_600_000).toISOString() });
    at = commit.parents[0] === undefined ? undefined : position.get(commit.parents[0]);
  }
  return {
    overview,
    runs: {
      runs,
      providers: [
        { provider: "GitHub", access: { kind: "ok", via: "Cli", runs: runs.length }, hasSavedToken: false, hasCli: true },
        { provider: "CircleCi", access: { kind: "needsToken", message: "Serve un token per leggere le run di questo progetto" }, hasSavedToken: false, hasCli: false },
      ],
    },
  };
}
const ci = fakeCi();

// The updater only runs inside the app; `?updates=1` pretends to be there.
if (new URLSearchParams(location.search).has("updates")) (window as unknown as Record<string, unknown>).isTauri = true;

(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
  transformCallback: (callback: (message: unknown) => void) => {
    const id = nextCallback++;
    callbacks.set(id, callback);
    return id;
  },
  unregisterCallback: (id: number) => callbacks.delete(id),
  invoke: async (command: string, args: Record<string, unknown>) => {
    switch (command) {
      case "load_commits":
        return load(args as unknown as Parameters<typeof load>[0]);
      case "search_commits": {
        const text = String(args.text).toLowerCase();
        await new Promise((resolve) => setTimeout(resolve, 400));
        const ids = dump.commits.filter((c) => c.summary.toLowerCase().includes(text)).map((c) => c.id);
        return { ids, truncated: false, cancelled: false, elapsedMs: 400 };
      }
      case "list_stashes":
        return [];
      case "plugin:app|version":
        return "0.3.0";
      case "plugin:updater|check":
        // `?updates=1`: a newer release is out.
        return new URLSearchParams(location.search).has("updates")
          ? { rid: 1, currentVersion: "0.3.0", version: "0.4.0", date: "2026-10-20", body: "- Compare two commits\n- Bookmarks\n- Search by date", rawJson: {} }
          : null;
      case "plugin:updater|download_and_install":
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return null;
      case "save_png":
        // Kept for inspection from the console: `__lastExport` is the PNG as base64.
        (window as unknown as Record<string, unknown>).__lastExport = args.base64;
        return `/dev/exports/${String(args.fileName)}`;
      case "cache_usage":
        return { files: 3, bytes: 24_600_000 };
      case "clear_cache":
        return 3;
      case "repo_web":
        return { name: "GitHub", commitUrl: "https://github.com/example/repo/commit/" };
      case "list_upstreams":
        // Every local branch tracks the remote branch of the same name, when there is one.
        return dump.refs
          .filter((r) => (r.kind === "Branch" || r.kind === "Head") && dump.refs.some((o) => o.kind === "Remote" && o.name === `origin/${r.name}`))
          .map((r) => ({ branch: r.name, upstream: `origin/${r.name}` }));
      case "commit_details": {
        const commit = dump.commits.find((c) => c.id === args.commitId);
        const person = { name: commit?.author ?? "", email: "dev@example.com", time: commit?.time ?? 0 };
        return { id: args.commitId, summary: commit?.summary ?? "", body: "", author: person, committer: person, parents: commit?.parents ?? [], comparedWith: null, files: [], statsTruncated: false };
      }
      case "ci_overview":
        return ci.overview;
      case "ci_runs":
        await new Promise((resolve) => setTimeout(resolve, 300));
        return ci.runs;
      case "close_repo":
      case "plugin:event|unlisten":
        return null;
      case "plugin:event|listen":
        return nextCallback++;
      default:
        return null;
    }
  },
};

// Read by `unlisten` when a component that listens for events unmounts.
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };

initTheme();
initLanguage();
const head = dump.refs.find((r) => r.kind === "Head");
useTabs.getState().addTab({
  sessionId: "s1",
  name,
  path: `/dev/${name}`,
  head: head ? { kind: "Branch", name: head.name, commit: head.commit } : { kind: "Unborn", name: "main" },
  refCount: dump.refs.length,
  isBare: false,
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
