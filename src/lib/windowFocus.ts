import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FocusPauseStore {
  /** Animations stop while another app has the focus, to spare the CPU. Off by default. */
  pauseUnfocused: boolean;
  setPauseUnfocused: (pause: boolean) => void;
}

export const useFocusPause = create<FocusPauseStore>()(
  persist(
    (set) => ({
      pauseUnfocused: false,
      setPauseUnfocused: (pause) => set({ pauseUnfocused: pause }),
    }),
    { name: "git-sea:focus-pause" },
  ),
);

function subscribe(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("blur", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("blur", onChange);
  };
}

/**
 * Whether animations may run as far as the focus goes: always, unless the user chose to pause them
 * while the app's window does not have the focus.
 */
export function useWindowFocused(): boolean {
  const focused = useSyncExternalStore(subscribe, () => document.hasFocus());
  const pause = useFocusPause((s) => s.pauseUnfocused);
  return focused || !pause;
}

/** The same as `useWindowFocused`, read once outside React. */
export function windowFocused(): boolean {
  return document.hasFocus() || !useFocusPause.getState().pauseUnfocused;
}
