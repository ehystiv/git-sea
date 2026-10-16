export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

/** The mode the toggle switches to: system, then light, then dark, then back. */
export function nextMode(mode: ThemeMode): ThemeMode {
  const at = THEME_MODES.indexOf(mode);
  return THEME_MODES[(at + 1) % THEME_MODES.length] ?? "system";
}

/** Anything that is not a known mode (a stale or hand-edited stored value) falls back to the system. */
export function parseMode(value: unknown): ThemeMode {
  return THEME_MODES.find((mode) => mode === value) ?? "system";
}
