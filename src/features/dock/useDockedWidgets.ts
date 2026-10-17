import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { DockController } from "./DockController";
import { useDock, type DockWidget } from "./dockStore";

/**
 * Makes the zoom controls and the minimap of a view draggable between its corners. `insetTop`
 * keeps the top corners below what the view draws there (the timeline's axis).
 */
export function useDockedWidgets(
  container: RefObject<HTMLElement | null>,
  widgets: Partial<Record<DockWidget, RefObject<HTMLElement | null>>>,
  insetRight: number,
  insetTop = 0,
): void {
  const controllerRef = useRef<DockController | null>(null);
  const corners = useDock((s) => s.corners);
  const last = useDock((s) => s.last);
  const move = useDock((s) => s.move);
  const initial = useRef({ corners, last, insetRight });

  // Before the first paint, so the widgets never show up at the top-left first.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const controller = new DockController(element, {
      insetTop,
      corners: initial.current.corners,
      priority: initial.current.last,
      onDrop: (id, corner) => move(id as DockWidget, corner),
    });
    controller.setInsetRight(initial.current.insetRight);
    for (const [id, ref] of Object.entries(widgets)) {
      if (ref?.current) controller.add(id, ref.current);
    }
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
    // The widgets are mounted once with the view.
  }, [container, insetTop]);

  useEffect(() => {
    controllerRef.current?.setOptions({ insetTop, corners, priority: last, onDrop: (id, corner) => move(id as DockWidget, corner) });
  }, [corners, last, move, insetTop]);

  useEffect(() => {
    controllerRef.current?.setInsetRight(insetRight);
  }, [insetRight]);
}
