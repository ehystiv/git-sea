import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Calls `onChange` when the backend reports that the refs of this session's repository changed,
 * with `"worktree-changed"` that its working copy or index did, with `"fetch-changed"` that a
 * background fetch started or ended.
 */
export function useRepoChanges(
  sessionId: string,
  onChange: () => void,
  event: "repo-changed" | "worktree-changed" | "fetch-changed" = "repo-changed",
): void {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>(event, (e) => {
      if (e.payload === sessionId) handler.current();
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      // Outside Tauri (a plain browser) there is nothing to listen to.
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId, event]);
}
