import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { menuPosition } from "./position";
import styles from "./ContextMenu.module.css";

export interface MenuItem {
  id: string;
  label: string;
  /** Shown on the right, like a shortcut or a detail. */
  hint?: string;
  run: () => void;
  /** A line above the item, to group it apart from the ones before. */
  separated?: boolean;
}

interface ContextMenuProps {
  /** Where the pointer was, in window coordinates. */
  x: number;
  y: number;
  /** Read by screen readers. */
  label: string;
  items: MenuItem[];
  onClose: () => void;
  /** Above the point, for a button near the bottom of the window. */
  placement?: "below" | "above";
}

/**
 * A menu at the pointer, above everything else. It closes on Escape, on a click outside, when the
 * window loses focus or scrolls, and after an item runs. Arrow keys move between the items.
 */
export function ContextMenu({ x, y, label, items, onClose, placement = "below" }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Measured before painting, so the menu never shows up in the wrong place.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    setPlace(menuPosition(x, y, menu.offsetWidth, menu.offsetHeight, window.innerWidth, window.innerHeight, placement));
  }, [x, y, placement]);

  // Only once placed: a hidden element cannot take the focus.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (placed) ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [placed]);

  useLayoutEffect(() => {
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The views listen on the window for j, k, Escape…: the menu keeps its keys to itself.
    event.stopPropagation();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => buttons[(to + buttons.length) % buttons.length]?.focus();
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
    else if (event.key === "Tab") onClose();
    else return;
    event.preventDefault();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={place ?? { left: x, top: y, visibility: "hidden" }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={`${styles.item} ${item.separated ? styles.separated : ""}`}
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          <span className={styles.label}>{item.label}</span>
          {item.hint && <span className={styles.hint}>{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
