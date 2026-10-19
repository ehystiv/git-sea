// Development only. Renders the details panel against JSON written by `examples/dump_commit.rs`,
// answering the Tauri commands from it. Query: ?file=<path>&mode=unified|split
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/tokens.css";
import "../styles/global.css";
import { DetailsPanel } from "../features/details/DetailsPanel";
import { fakeIndex } from "../features/graph/testData";
import type { CommitDetails, CommitSummary, FileDiff } from "../lib/bindings";

interface Dump {
  commit: CommitSummary;
  details: CommitDetails;
  diffs: Record<string, FileDiff>;
}

const dump = (await (await fetch("/dev-data/commit.json")).json()) as Dump;

// What @tauri-apps/api/core's invoke() talks to.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (command: string, args: { path?: string }) => {
    if (command === "commit_details") return dump.details;
    if (command === "file_diff") return dump.diffs[args.path ?? ""];
    throw new Error(`unexpected command ${command}`);
  },
};

const index = fakeIndex(
  dump.commit.parents.map((id) => ({ id, summary: "feat(graph): add view math" })).concat([{ id: dump.commit.id, summary: dump.commit.summary }]),
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ width: Number(new URLSearchParams(location.search).get("w") ?? 460), height: "100%", borderRight: "1px solid var(--border)" }}>
        <DetailsPanel sessionId="s1" commit={dump.commit} index={index} version={0} onSelectCommit={() => undefined} />
      </div>
    </QueryClientProvider>
  </StrictMode>,
);

// ?file=<path> picks a file once the list is on screen; ?mode=split switches the diff layout.
const params = new URLSearchParams(location.search);
setTimeout(() => {
  const file = params.get("file");
  if (file) document.querySelector<HTMLButtonElement>(`button[title="${file}"]`)?.click();
  if (params.get("mode") === "split") {
    [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) => b.textContent === "Affiancato")?.click();
  }
}, 1500);
