import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nextMode, parseMode, resolveTheme, type ThemeMode } from "./themeLogic";

/** Fired on `window` after the theme attribute changed, for canvases that read colours from CSS. */
export const THEME_CHANGED = "git-sea:theme-changed";

interface ThemeStore {
  mode: ThemeMode;
  cycle: () => void;
  setMode: (mode: ThemeMode) => void;
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: "system",
      cycle: () => set((s) => ({ mode: nextMode(s.mode) })),
      setMode: (mode) => set({ mode }),
    }),
    {
      name: "git-sea:theme",
      partialize: (s) => ({ mode: s.mode }),
      merge: (stored, current) => ({ ...current, mode: parseMode((stored as Partial<ThemeStore> | null)?.mode) }),
    },
  ),
);

function apply(mode: ThemeMode): void {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = resolveTheme(mode, dark);
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new Event(THEME_CHANGED));
  }
  // The native window material (sidebar vibrancy) has its own theme: keep it in step with the page.
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode === "system" ? null : mode))
      .catch(() => undefined);
  }
}

/** Sets `data-theme` on the root and keeps it up to date. Call once, before the first render. */
export function initTheme(): void {
  apply(useTheme.getState().mode);
  useTheme.subscribe((state) => apply(state.mode));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => apply(useTheme.getState().mode));
}

/** Re-runs `callback` whenever the theme changes. */
export function useThemeChanged(callback: () => void): void {
  useEffect(() => {
    window.addEventListener(THEME_CHANGED, callback);
    return () => window.removeEventListener(THEME_CHANGED, callback);
  }, [callback]);
}
