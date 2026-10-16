import { useCallback, useEffect, useState, type TransitionEvent } from "react";

/** Longest the closing transition may take before the drawer is removed anyway. */
const CLOSE_FALLBACK_MS = 600;

/**
 * Keeps a drawer mounted while it slides out. `mounted` says whether to render it, `shown` whether
 * it is in place (the CSS transitions between the two positions); pass `onTransitionEnd` to it.
 * Opening mounts it off screen first and moves it in on the next frame, so it slides in.
 */
export function useDrawer(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (!open) {
      setShown(false);
      // A hidden tab runs no transitions, so their end never comes: remove the drawer anyway.
      const timer = setTimeout(() => setMounted(false), CLOSE_FALLBACK_MS);
      return () => clearTimeout(timer);
    }
    setMounted(true);
    // Two frames: the first lays the drawer out off screen, the second starts the transition.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [open]);

  const onTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && !open) setMounted(false);
    },
    [open],
  );

  return { mounted, shown, onTransitionEnd };
}
