import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Calls `onPath` when a folder is dropped on the window.
 * Returns whether something is currently being dragged over it.
 */
export function useRepoDrop(onPath: (path: string) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    // Outside Tauri (plain `pnpm dev` in a browser) getCurrentWebview() throws: nothing to listen to.
    let webview: ReturnType<typeof getCurrentWebview>;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }

    webview
      .onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true);
        } else if (payload.type === "drop") {
          setIsDragging(false);
          const [first] = payload.paths;
          if (first) onPath(first);
        } else {
          setIsDragging(false);
        }
      })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onPath]);

  return isDragging;
}
