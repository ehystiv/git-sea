/**
 * The few things that differ between macOS and Linux in the UI: which key is the shortcut
 * modifier (⌘ or Ctrl), how shortcuts are written, and the window chrome (see `applyPlatform`).
 */

export const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

interface ModifierState {
  metaKey: boolean;
  ctrlKey: boolean;
}

/** True when the shortcut modifier, and only that one of ⌘/Ctrl, is held: ⌘ on macOS, Ctrl elsewhere. */
export function hasModKey(event: ModifierState, mac: boolean = IS_MAC): boolean {
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** A shortcut as the platform writes it: "⌘K" on macOS, "Ctrl+K" elsewhere. */
export function modShortcut(key: string, mac: boolean = IS_MAC): string {
  return mac ? `⌘${key}` : `Ctrl+${key}`;
}

/**
 * Marks the document with the platform, for the CSS: on macOS the window is transparent with
 * vibrancy and an overlay title bar; elsewhere it is opaque and has the system's decorations.
 */
export function applyPlatform(): void {
  document.documentElement.dataset.platform = IS_MAC ? "mac" : "other";
}
