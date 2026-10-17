/** Room kept between the menu and the window's edges. */
const MARGIN = 8;

/**
 * Where a menu opened at (x, y) goes: below and right of the pointer (or above it, for a button at
 * the bottom), flipped when it would leave the window, and never past its edges.
 */
export function menuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
  placement: "below" | "above" = "below",
): { left: number; top: number } {
  const left = x + width + MARGIN > viewWidth ? x - width : x;
  const fitsBelow = y + height + MARGIN <= viewHeight;
  const fitsAbove = y - height - MARGIN >= 0;
  const top = placement === "above" ? (fitsAbove || !fitsBelow ? y - height : y) : fitsBelow ? y : y - height;
  return {
    left: Math.max(MARGIN, Math.min(left, viewWidth - width - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, viewHeight - height - MARGIN)),
  };
}
