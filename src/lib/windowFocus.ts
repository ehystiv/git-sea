import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
}

/** Whether the app's window has the focus: animations run only then, to spare the CPU. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, () => document.hasFocus());
}
