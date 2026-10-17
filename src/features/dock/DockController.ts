import { BOUNCE, MAX_THROW, bounceOffEdges, dropCorner, layoutDock, springAtRest, springStep, type Corner, type DockArea, type Point, type SpringState } from "./dock";

/** The CSS attribute that marks the part of a widget it is dragged by. */
export const DOCK_HANDLE = "data-dock-handle";
const MARGIN = 16;
/** Drags shorter than this are clicks on the handle, and leave the widget where it is. */
const DRAG_THRESHOLD = 3;

interface Widget {
  id: string;
  element: HTMLElement;
  x: SpringState;
  y: SpringState;
  target: Point;
  drag: { pointer: number; dx: number; dy: number; startX: number; startY: number; moved: boolean; samples: Array<{ t: number; x: number; y: number }> } | null;
}

export interface DockOptions {
  /** Pixels kept free at the top of the view (the timeline's axis). */
  insetTop: number;
  corners: Record<string, Corner>;
  /** The widget that keeps its corner when two collide. */
  priority: string | null;
  /** A widget was dropped: where it should rest from now on. */
  onDrop: (id: string, corner: Corner) => void;
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Floating widgets over a view, each resting in a corner. They are dragged by their handle and,
 * once let go, travel to the nearest corner not taken by another one with a spring that keeps the
 * speed of the throw and bounces a little. Positions are set as transforms, outside React.
 */
export class DockController {
  private readonly widgets: Widget[] = [];
  private insetRight = 0;
  private frame = 0;
  private last = 0;
  private readonly observer: ResizeObserver;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly container: HTMLElement,
    private options: DockOptions,
  ) {
    this.observer = new ResizeObserver(() => this.layout(false));
    this.observer.observe(container);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.disposers.forEach((dispose) => dispose());
  }

  add(id: string, element: HTMLElement): void {
    const widget: Widget = { id, element, x: { x: 0, v: 0 }, y: { x: 0, v: 0 }, target: { x: 0, y: 0 }, drag: null };
    this.widgets.push(widget);
    this.observer.observe(element);
    const handle = element.querySelector<HTMLElement>(`[${DOCK_HANDLE}]`) ?? element;
    const down = (e: PointerEvent) => this.onPointerDown(widget, handle, e);
    const move = (e: PointerEvent) => this.onPointerMove(widget, e);
    const up = (e: PointerEvent) => this.onPointerUp(widget, handle, e);
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    this.disposers.push(() => {
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    });
    this.layout(false);
  }

  /** The details panel covers this much of the view on the right: widgets there make room. */
  setInsetRight(px: number): void {
    if (px === this.insetRight) return;
    this.insetRight = px;
    this.layout(true);
  }

  /** The corners changed (here or in another view): the widgets travel to them. */
  setOptions(options: DockOptions): void {
    this.options = options;
    this.layout(true);
  }

  private area(): DockArea {
    return { width: this.container.clientWidth, height: this.container.clientHeight, insetRight: this.insetRight, insetTop: this.options.insetTop, margin: MARGIN };
  }

  private size(widget: Widget) {
    return { width: widget.element.offsetWidth, height: widget.element.offsetHeight };
  }

  /** Works out every resting place; `animate` moves the widgets there with the spring. */
  private layout(animate: boolean): void {
    const area = this.area();
    if (area.width === 0 || area.height === 0) return;
    const ordered = [...this.widgets].sort((a, b) => Number(b.id === this.options.priority) - Number(a.id === this.options.priority));
    const places = layoutDock(
      ordered.map((w) => ({ id: w.id, size: this.size(w), corner: this.options.corners[w.id] ?? "bottom-right" })),
      area,
    );
    for (const widget of this.widgets) {
      const place = places.get(widget.id);
      if (!place) continue;
      widget.target = place.at;
      if (widget.drag) continue;
      if (!animate || reducedMotion()) {
        widget.x = { x: place.at.x, v: 0 };
        widget.y = { x: place.at.y, v: 0 };
        this.apply(widget);
      }
    }
    if (animate) this.start();
  }

  private apply(widget: Widget): void {
    widget.element.style.transform = `translate(${Math.round(widget.x.x * 2) / 2}px, ${Math.round(widget.y.x * 2) / 2}px)`;
  }

  private start(): void {
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.frame = 0;
    // Small fixed steps keep the spring stable even after a long frame.
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let moving = false;
    for (const widget of this.widgets) {
      if (widget.drag) continue;
      if (springAtRest(widget.x, widget.target.x) && springAtRest(widget.y, widget.target.y)) {
        if (widget.x.x !== widget.target.x || widget.y.x !== widget.target.y) {
          widget.x = { x: widget.target.x, v: 0 };
          widget.y = { x: widget.target.y, v: 0 };
          this.apply(widget);
        }
        continue;
      }
      const { width, height } = this.size(widget);
      const maxX = Math.max(0, this.container.clientWidth - width);
      const maxY = Math.max(0, this.container.clientHeight - height);
      for (let left = dt; left > 0; left -= 1 / 240) {
        const step = Math.min(left, 1 / 240);
        widget.x = bounceOffEdges(springStep(widget.x, widget.target.x, step, BOUNCE), 0, maxX);
        widget.y = bounceOffEdges(springStep(widget.y, widget.target.y, step, BOUNCE), 0, maxY);
      }
      this.apply(widget);
      moving = true;
    }
    if (moving) this.start();
  }

  // ---- dragging --------------------------------------------------------------------------

  private onPointerDown(widget: Widget, handle: HTMLElement, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser does not track (synthetic events): the drag works without capture.
    }
    const box = this.container.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    widget.drag = { pointer: e.pointerId, dx: px - widget.x.x, dy: py - widget.y.x, startX: px, startY: py, moved: false, samples: [{ t: performance.now(), x: widget.x.x, y: widget.y.x }] };
  }

  private onPointerMove(widget: Widget, e: PointerEvent): void {
    const drag = widget.drag;
    if (!drag || e.pointerId !== drag.pointer) return;
    const box = this.container.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    if (!drag.moved && Math.hypot(px - drag.startX, py - drag.startY) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      widget.element.dataset.dragging = "";
    }
    const { width, height } = this.size(widget);
    const x = Math.max(0, Math.min(this.container.clientWidth - width, px - drag.dx));
    const y = Math.max(0, Math.min(this.container.clientHeight - height, py - drag.dy));
    widget.x = { x, v: 0 };
    widget.y = { x: y, v: 0 };
    const now = performance.now();
    drag.samples.push({ t: now, x, y });
    // The last tenth of a second gives the speed of the throw.
    while (drag.samples.length > 2 && now - (drag.samples[0]?.t ?? now) > 100) drag.samples.shift();
    this.apply(widget);
  }

  private onPointerUp(widget: Widget, handle: HTMLElement, e: PointerEvent): void {
    const drag = widget.drag;
    if (!drag || e.pointerId !== drag.pointer) return;
    widget.drag = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    delete widget.element.dataset.dragging;
    if (!drag.moved) return;

    const first = drag.samples[0];
    const lastSample = drag.samples[drag.samples.length - 1];
    if (first && lastSample && lastSample.t > first.t) {
      const seconds = (lastSample.t - first.t) / 1000;
      const clamp = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
      widget.x.v = clamp((lastSample.x - first.x) / seconds);
      widget.y.v = clamp((lastSample.y - first.y) / seconds);
    }
    const area = this.area();
    const others = this.widgets.filter((w) => w !== widget).map((w) => ({ ...w.target, ...this.size(w) }));
    const corner = dropCorner({ x: widget.x.x, y: widget.y.x }, this.size(widget), area, others);
    this.options = { ...this.options, corners: { ...this.options.corners, [widget.id]: corner }, priority: widget.id };
    this.layout(true);
    this.options.onDrop(widget.id, corner);
  }
}
