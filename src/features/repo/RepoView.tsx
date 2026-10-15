import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { CommitList } from "../commits/CommitList";
import { LoadStatus } from "../commits/LoadStatus";
import { useCommitStream } from "../commits/useCommitStream";
import { DetailsPanel } from "../details/DetailsPanel";
import { GraphCanvas, type GraphCanvasHandle } from "../graph/GraphCanvas";
import { Sidebar } from "../sidebar/Sidebar";
import { shortHash } from "../../lib/format";
import { headCommitId } from "./head";
import { useRepoChanges } from "./useRepoChanges";
import type { CommitSummary, HeadInfo, RepoInfo } from "../../lib/bindings";
import styles from "./RepoView.module.css";

type ViewMode = "graph" | "list";

const PANEL_MIN = 320;
const PANEL_MAX = 900;
const PANEL_DEFAULT = 440;

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

export function RepoView({ repo, active, onClose }: RepoViewProps) {
  const stream = useCommitStream(repo.sessionId);
  const [mode, setMode] = useState<ViewMode>("graph");
  const [selected, setSelected] = useState<CommitSummary | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const graphRef = useRef<GraphCanvasHandle>(null);
  const head = describeHead(repo.head);
  const { index, reload } = stream;
  const queryClient = useQueryClient();

  // A commit, fetch, branch or tag changed the refs: reload quietly and refresh the stashes too.
  useRepoChanges(
    repo.sessionId,
    useCallback(() => {
      reload();
      void queryClient.invalidateQueries({ queryKey: ["stashes", repo.sessionId] });
    }, [reload, queryClient, repo.sessionId]),
  );

  // Enter shows or hides the details panel.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const onButton = target?.tagName === "BUTTON";
      if (event.key === "Enter" && !typing && !onButton && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setPanelOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  const selectById = useCallback(
    (id: string) => {
      if (mode === "graph") {
        graphRef.current?.selectById(id);
        return;
      }
      const at = index.indexOf(id);
      const commit = at === null ? undefined : index.commits[at];
      if (commit) setSelected(commit);
    },
    [mode, index],
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
      <Sidebar sessionId={repo.sessionId} index={index} version={stream.version} selectedId={selected?.id ?? null} onSelectCommit={selectById} />

      <div className={styles.content}>
      <div className={styles.toolbar}>
        <Badge color={0}>{head.label}</Badge>
        {head.detail && <code className={styles.detail}>{head.detail}</code>}
        <span className={styles.meta}>{repo.refCount} riferimenti</span>
        {repo.isBare && <span className={styles.meta}>bare</span>}

        <div className={styles.seg} role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={mode === "graph"} className={mode === "graph" ? styles.active : undefined} onClick={() => setMode("graph")}>
            Grafo
          </button>
          <button type="button" role="tab" aria-selected={mode === "list"} className={mode === "list" ? styles.active : undefined} onClick={() => setMode("list")}>
            Elenco
          </button>
        </div>

        <code className={`${styles.path} selectable`}>{repo.path}</code>
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

      <div className={styles.body} style={panelOpen ? { gridTemplateColumns: `minmax(0, 1fr) ${panelWidth}px` } : undefined}>
        <div className={styles.main}>
          {mode === "graph" ? (
            <GraphCanvas ref={graphRef} index={index} version={stream.version} initialSelectedId={selected?.id ?? null} active={active} onSelect={setSelected} />
          ) : (
            <CommitList commits={index.commits} selectedId={selected?.id ?? null} onSelect={setSelected} />
          )}
        </div>

        {panelOpen && (
          <div className={styles.panel}>
            <div className={styles.resizer} onPointerDown={startResize} role="separator" aria-orientation="vertical" aria-label="Ridimensiona il pannello" />
            <DetailsPanel sessionId={repo.sessionId} commit={selected} index={index} onSelectCommit={selectById} />
          </div>
        )}
      </div>

      <LoadStatus stream={stream} selected={selected} />
      </div>
    </div>
  );
}
