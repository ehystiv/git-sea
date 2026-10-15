import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

/** Calls `onChange` when the backend reports that the refs of this session's repository changed. */
export function useRepoChanges(sessionId: string, onChange: () => void): void {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<string>("repo-changed", (event) => {
      if (event.payload === sessionId) handler.current();
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
  }, [sessionId]);
}
