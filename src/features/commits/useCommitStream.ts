import { useCallback, useEffect, useMemo, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type LoadEvent } from "../../lib/bindings";
import { GraphIndex } from "../graph/GraphIndex";

export interface BackendTimings {
  setupMs: number;
  firstChunkMs: number;
  totalMs: number;
}

export interface CommitStream {
  /** Mutable store of everything loaded so far; `version` changes whenever it does. */
  index: GraphIndex;
  version: number;
  status: "loading" | "done" | "error";
  /** Milliseconds from the request to the first chunk reaching the UI. */
  firstChunkMs: number | null;
  /** Milliseconds from the request to the last chunk reaching the UI. */
  doneMs: number | null;
  backend: BackendTimings | null;
  /** Most graph lanes open at once; known when the load is done. */
  maxLanes: number | null;
  /** The graph was read from the on-disk cache. */
  fromCache: boolean;
  /** The history is being reloaded in the background; the old one stays on screen meanwhile. */
  refreshing: boolean;
  error: string | null;
  /** Reloads the history without clearing the screen (the repository's refs changed). */
  reload: () => void;
}

type StreamState = Omit<CommitStream, "index" | "reload">;

const INITIAL: StreamState = {
  version: 0,
  status: "loading",
  firstChunkMs: null,
  doneMs: null,
  backend: null,
  maxLanes: null,
  fromCache: false,
  refreshing: false,
  error: null,
};

/** Loads every commit of a session into a GraphIndex as the chunks arrive. */
export function useCommitStream(sessionId: string): CommitStream {
  const index = useMemo(() => new GraphIndex(), [sessionId]);
  const [state, setState] = useState<StreamState>(INITIAL);
  const [reloads, setReloads] = useState(0);
  const reload = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    // The first load fills `index` as chunks arrive. A reload fills a fresh one off screen and
    // swaps it in when complete, so the graph never flashes empty or jumps.
    const refreshing = reloads > 0;
    const target = refreshing ? new GraphIndex() : index;
    if (refreshing) {
      setState((prev) => ({ ...prev, refreshing: true, error: null }));
    } else {
      index.reset();
      setState(INITIAL);
    }

    const channel = new Channel<LoadEvent>();
    channel.onmessage = (event) => {
      if (!active) return;
      if (event.event === "refs") {
        target.setRefs(event.data.refs);
        if (!refreshing) setState((prev) => ({ ...prev, version: prev.version + 1 }));
      } else if (event.event === "chunk") {
        target.appendChunk(event.data.commits, event.data.rows);
        if (refreshing) return;
        setState((prev) => ({
          ...prev,
          version: prev.version + 1,
          firstChunkMs: prev.firstChunkMs ?? elapsed(),
        }));
      } else {
        const { setupMs, firstChunkMs, totalMs, maxLanes, fromCache } = event.data;
        if (refreshing) index.replaceWith(target);
        setState((prev) => ({
          ...prev,
          version: refreshing ? prev.version + 1 : prev.version,
          status: "done",
          refreshing: false,
          doneMs: elapsed(),
          backend: { setupMs, firstChunkMs, totalMs },
          maxLanes,
          fromCache,
        }));
      }
    };

    commands
      .loadCommits(sessionId, channel)
      .then((result) => {
        if (active && result.status === "error") {
          setState((prev) => ({ ...prev, status: "error", error: result.error.message }));
        }
      })
      .catch((error: unknown) => {
        if (active) setState((prev) => ({ ...prev, status: "error", error: String(error) }));
      });

    return () => {
      active = false;
    };
  }, [sessionId, index, reloads]);

  return { index, reload, ...state };
}
