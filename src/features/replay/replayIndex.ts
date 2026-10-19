import { Channel } from "@tauri-apps/api/core";
import { commands, type LoadEvent } from "../../lib/bindings";
import { compressIndex } from "../graph/compress";
import { GraphIndex } from "../graph/GraphIndex";

/**
 * The history of one commit (it and its ancestors), laid out as a graph of its own, as the
 * topology shows it when `compressed`. Rejects when the backend cannot walk it.
 */
export function loadReplayIndex(sessionId: string, commitId: string, compressed: boolean): Promise<GraphIndex> {
  return new Promise((resolve, reject) => {
    const index = new GraphIndex();
    const channel = new Channel<LoadEvent>();
    channel.onmessage = (event) => {
      if (event.event === "refs") index.setRefs(event.data.refs);
      else if (event.event === "chunk") index.appendChunk(event.data.commits, event.data.rows);
      else resolve(compressed ? compressIndex(index, new Set()) : index);
    };
    commands
      .replayCommits(sessionId, commitId, channel)
      .then((result) => {
        if (result.status === "error") reject(new Error(result.error.message));
      })
      .catch(reject);
  });
}
