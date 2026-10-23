import { useEffect, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands, type ActivityEvent, type FileActivity } from "../../lib/bindings";
import { CommandError, describeError } from "../../lib/errors";

export interface FileActivityState {
  /** The latest complete answer; kept while a newer one is read. */
  activity: FileActivity | null;
  /** Commits read and to read, while reading. */
  progress: { done: number; total: number } | null;
  error: string | null;
}

/**
 * Which files every commit changed, asked for while `enabled` and again each time `refresh`
 * changes (the history was loaded again). The backend keeps what it read, so asking again only
 * reads the new commits.
 */
export function useFileActivity(sessionId: string, enabled: boolean, refresh: unknown): FileActivityState {
  const [state, setState] = useState<FileActivityState>({ activity: null, progress: null, error: null });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const channel = new Channel<ActivityEvent>();
    channel.onmessage = (event) => {
      if (!active) return;
      if (event.event === "progress") setState((prev) => ({ ...prev, progress: event.data }));
      else setState({ activity: event.data, progress: null, error: null });
    };
    commands
      .fileActivity(sessionId, channel)
      .then((result) => {
        if (active && result.status === "error") setState((prev) => ({ ...prev, progress: null, error: describeError(new CommandError(result.error)) }));
      })
      .catch((error: unknown) => {
        if (active) setState((prev) => ({ ...prev, progress: null, error: String(error) }));
      });
    return () => {
      active = false;
    };
  }, [sessionId, enabled, refresh]);

  return state;
}
