/** Room kept between the menu and the window's edges. */
const MARGIN = 8;

/**
 * Where a menu opened at (x, y) goes: below and right of the pointer, or flipped above or to the
 * left when it would leave the window, and never past its edges.
 */
export function menuPosition(x: number, y: number, width: number, height: number, viewWidth: number, viewHeight: number): { left: number; top: number } {
  const left = x + width + MARGIN > viewWidth ? x - width : x;
  const top = y + height + MARGIN > viewHeight ? y - height : y;
  return {
    left: Math.max(MARGIN, Math.min(left, viewWidth - width - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, viewHeight - height - MARGIN)),
  };
}
