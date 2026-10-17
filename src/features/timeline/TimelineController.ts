import { LANGUAGE_CHANGED } from "../../lib/i18n";
import { hasModKey, IS_MAC } from "../../lib/platform";
import { THEME_CHANGED } from "../../lib/theme";
import type { Emphasis } from "../graph/emphasis";
import { drawFlow, FlowOverlay, type FlowFrame } from "../graph/flow";
import type { GraphIndex } from "../graph/GraphIndex";
import { readPalette, type Palette } from "../graph/palette";
import { drawTimeline, hitTestTimeline } from "./draw";
import { buildTimeline, type TimelineData } from "./layout";
import {
  AXIS_H,
  BASE_ZX,
  centeredOnTimeline,
  clampTimelineView,
  fitTimeline,
  homeTimeline,
  zoomAtX,
  type TimelineView,
} from "./view";

export interface TimelineCallbacks {
  onSelect: (index: number | null) => void;
  /** ⇧-click on a commit other than the selected one: compare the two. */
  onCompare?: (index: number) => void;
  /** Zoom as a ratio of the 100 px/day shown as 100%. */
  onZoom: (zoom: number) => void;
}

interface Animation {
  from: TimelineView;
  to: TimelineView;
  start: number;
  duration: number;
}

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.5;

/**
 * Owns the timeline canvas: the view (a time window and a vertical scroll), selection, input and
 * the draw loop. Like `GraphController`, it keeps all of this out of React state.
 */
export class TimelineController {
  private readonly ctx: CanvasRenderingContext2D;
  private palette: Palette;
  private data: TimelineData | null = null;
  private dirty = true;
  private view: TimelineView = { t0: 0, ty: AXIS_H + 34, zx: BASE_ZX };
  private width = 0;
  private height = 0;
  /** Pixels on the right covered by something floating above the canvas (the details panel). */
  private insetRight = 0;
  private dpr = 1;
  private placed = false;
  private selected: number | null = null;
  private hovered: number | null = null;
  private frame = 0;
  private animation: Animation | null = null;
  private drag: { x: number; y: number; t0: number; ty: number; moved: boolean } | null = null;
  private gestureStartZoom = 1;
  private pendingG = 0;
  private active = true;
  private flow = false;
  /** See the fields of the same name in GraphController. */
  private flowOverlay: FlowOverlay | null = null;
  private flowFrame: FlowFrame | null = null;
  /** Something changed since the last frame (not `dirty`, which is about the data). */
  private needsDraw = true;
  private focused = true;
  private emphasis: Emphasis | null = null;
  private selectedBeforeReplace: string | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly index: GraphIndex,
    private readonly callbacks: TimelineCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.palette = readPalette();
    this.attach();
    this.disposers.push(
      index.onReplace({
        before: () => {
          this.selectedBeforeReplace = this.selected === null ? null : (this.index.commits[this.selected]?.id ?? null);
        },
        after: () => this.afterReplace(),
      }),
    );
    void this.loadFonts();
  }

  // ---- lifecycle -------------------------------------------------------------------------

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.disposers.forEach((dispose) => dispose());
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.requestDraw();
  }

  /** See `GraphController.setFocused`. */
  setFocused(focused: boolean): void {
    this.focused = focused;
    if (focused) this.schedule();
  }

  /** See `GraphController.attachFlowCanvas`. */
  attachFlowCanvas(canvas: HTMLCanvasElement): void {
    this.flowOverlay = new FlowOverlay(canvas);
    if (this.width > 0) this.flowOverlay.resize(this.width, this.height, this.dpr);
    this.requestDraw();
  }

  /** See `GraphController.setInsetRight`. */
  setInsetRight(px: number): void {
    this.insetRight = Math.max(0, px);
  }

  private get visibleWidth(): number {
    return Math.max(1, this.width - this.insetRight);
  }

  resize(width: number, height: number, dpr: number): void {
    if (width === 0 || height === 0) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.flowOverlay?.resize(width, height, dpr);
    const data = this.currentData();
    if (this.placed && data.count > 0) this.view = this.clamp(this.view);
    this.requestDraw();
  }

  /** Call after the index changed (new chunk, refs, reset). */
  dataChanged(): void {
    this.dirty = true;
    if (this.index.length === 0) {
      this.placed = false;
      this.selected = null;
      this.hovered = null;
    } else if (!this.placed && this.width > 0) {
      this.view = homeTimeline(this.currentData(), this.lanes, this.visibleWidth, this.height);
      this.placed = true;
      this.callbacks.onZoom(this.view.zx / BASE_ZX);
    }
    this.requestDraw();
  }

  private afterReplace(): void {
    this.animation = null;
    this.hovered = null;
    this.dirty = true;
    if (this.selectedBeforeReplace !== null) {
      this.selected = this.index.indexOf(this.selectedBeforeReplace);
      if (this.selected === null) this.callbacks.onSelect(null);
    }
    this.selectedBeforeReplace = null;
    // The view is a time window, so it already stays on the same commits.
    if (this.placed) this.view = this.clamp(this.view);
    this.requestDraw();
  }

  private get lanes(): number {
    return this.index.maxLane + 1;
  }

  private currentData(): TimelineData {
    if (!this.data || this.dirty) {
      this.data = buildTimeline(this.index);
      this.dirty = false;
    }
    return this.data;
  }

  private clamp(view: TimelineView): TimelineView {
    return clampTimelineView(view, this.currentData(), this.lanes, this.width, this.height);
  }

  // ---- commands --------------------------------------------------------------------------

  get zoom(): number {
    return this.view.zx / BASE_ZX;
  }

  zoomBy(factor: number): void {
    this.animateTo(zoomAtX(this.view, factor, this.visibleWidth / 2, this.currentData(), this.width));
  }

  fit(): void {
    if (this.index.length > 0) this.animateTo(fitTimeline(this.currentData(), this.lanes, this.visibleWidth, this.height));
  }

  select(index: number | null, center = true): void {
    this.selected = index;
    this.callbacks.onSelect(index);
    if (index !== null && center) this.centerOn(index);
    this.requestDraw();
  }

  centerOn(index: number): void {
    const data = this.currentData();
    const lane = this.index.rows[index]?.lane ?? 0;
    this.animateTo(centeredOnTimeline(this.view, data.times[index] ?? 0, lane, this.visibleWidth, this.height));
  }

  /** Sets the view directly (used by profiling scripts). */
  setView(view: TimelineView): void {
    this.animation = null;
    this.view = this.clamp(view);
    this.placed = true;
    this.requestDraw();
  }

  // ---- drawing ---------------------------------------------------------------------------

  /** Something in the timeline changed: draw it again on the next frame. */
  requestDraw(): void {
    this.needsDraw = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.step(now);
    });
  }

  private step(now: number): void {
    const redraw = this.needsDraw;
    this.needsDraw = false;
    if (this.animation) {
      const { from, to, start, duration } = this.animation;
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.view = {
        t0: from.t0 + (to.t0 - from.t0) * e,
        ty: from.ty + (to.ty - from.ty) * e,
        zx: from.zx * Math.pow(to.zx / from.zx, e),
      };
      this.callbacks.onZoom(this.zoom);
      if (t >= 1) this.animation = null;
      else this.requestDraw();
    }
    // Drawn only when something changed; the dots move on their own canvas (see GraphController).
    const moving = redraw ? this.render(now) : false;
    const animate = this.active && this.focused && !document.hidden;
    const overlay = this.flowOverlay;
    if (overlay) {
      overlay.setFrame(this.flow ? this.flowFrame : null);
      if ((redraw || animate) && overlay.tick(now, redraw) && animate) this.schedule();
    } else if (moving && animate) {
      this.requestDraw();
    }
  }

  /** Draws a frame; returns true when there are dots moving (drawn here without their canvas). */
  render(time: number = performance.now()): boolean {
    if (this.width === 0 || this.height === 0) return false;
    const flow = drawTimeline(this.ctx, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      view: this.view,
      index: this.index,
      data: this.currentData(),
      palette: this.palette,
      selected: this.selected,
      hovered: this.hovered,
      flow: this.flow,
      emphasis: this.emphasis,
    });
    this.flowFrame = flow;
    return flow !== null && (this.flowOverlay !== null || drawFlow(this.ctx, flow.links, { ...flow.style, time }) > 0);
  }

  /** Keeps these commits bright and fades the rest; null shows everything normally. */
  setEmphasis(emphasis: Emphasis | null): void {
    this.emphasis = emphasis;
    this.requestDraw();
  }

  /** Switches the dots travelling along the links on or off. */
  setFlow(enabled: boolean): void {
    this.flow = enabled;
    this.requestDraw();
  }

  private animateTo(target: TimelineView, duration = 220): void {
    this.animation = { from: this.view, to: this.clamp(target), start: performance.now(), duration };
    this.requestDraw();
  }

  private setViewNow(view: TimelineView): void {
    this.animation = null;
    this.view = this.clamp(view);
    this.callbacks.onZoom(this.zoom);
    this.requestDraw();
  }

  private async loadFonts(): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load(`500 11px ${this.palette.fontUi}`),
        document.fonts.load(`500 11px ${this.palette.fontMono}`),
      ]);
      this.requestDraw();
    } catch {
      // Falling back to the system fonts is fine.
    }
  }

  // ---- input -----------------------------------------------------------------------------

  private attach(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      this.canvas.addEventListener(type, handler, options);
      this.disposers.push(() => this.canvas.removeEventListener(type, handler, options));
    };

    on("pointerdown", (e) => this.onPointerDown(e));
    on("pointermove", (e) => this.onPointerMove(e));
    on("pointerup", (e) => this.onPointerUp(e));
    on("pointerleave", () => this.setHover(null));
    on("wheel", (e) => this.onWheel(e), { passive: false });

    // Safari / WKWebView reports trackpad pinch as non-standard gesture events.
    const gestureStart = (e: Event) => {
      e.preventDefault();
      this.gestureStartZoom = this.view.zx;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const { scale, clientX } = e as unknown as { scale: number; clientX: number };
      const rect = this.canvas.getBoundingClientRect();
      const factor = (this.gestureStartZoom * scale) / this.view.zx;
      this.setViewNow(zoomAtX(this.view, factor, clientX - rect.left, this.currentData(), this.width));
    };
    this.canvas.addEventListener("gesturestart", gestureStart);
    this.canvas.addEventListener("gesturechange", gestureChange);
    this.disposers.push(() => {
      this.canvas.removeEventListener("gesturestart", gestureStart);
      this.canvas.removeEventListener("gesturechange", gestureChange);
    });

    const visibility = () => {
      if (!document.hidden) this.schedule();
    };
    document.addEventListener("visibilitychange", visibility);
    this.disposers.push(() => document.removeEventListener("visibilitychange", visibility));

    const keydown = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener("keydown", keydown);
    this.disposers.push(() => window.removeEventListener("keydown", keydown));

    const themeChanged = () => {
      this.palette = readPalette();
      this.requestDraw();
    };
    window.addEventListener(THEME_CHANGED, themeChanged);
    this.disposers.push(() => window.removeEventListener(THEME_CHANGED, themeChanged));

    // The axis labels (month names) are in the UI language.
    const languageChanged = () => this.requestDraw();
    window.addEventListener(LANGUAGE_CHANGED, languageChanged);
    this.disposers.push(() => window.removeEventListener(LANGUAGE_CHANGED, languageChanged));
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private hit(x: number, y: number): number | null {
    return hitTestTimeline(this.currentData(), this.index, this.view, x, y);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.animation = null;
    const { x, y } = this.local(e);
    this.drag = { x, y, t0: this.view.t0, ty: this.view.ty, moved: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    if (!this.drag) {
      this.setHover(this.hit(x, y));
      return;
    }
    const dx = x - this.drag.x;
    const dy = y - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this.drag.moved = true;
    this.canvas.style.cursor = "grabbing";
    this.setViewNow({ ...this.view, t0: this.drag.t0 - dx / this.view.zx, ty: this.drag.ty + dy });
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.canvas.style.cursor = this.hovered === null ? "grab" : "pointer";
    if (!drag || drag.moved) return;
    const { x, y } = this.local(e);
    const hit = this.hit(x, y);
    if (e.shiftKey && hit !== null && this.selected !== null && hit !== this.selected && this.callbacks.onCompare) {
      this.callbacks.onCompare(hit);
      return;
    }
    this.select(hit, false);
  }

  private setHover(index: number | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.canvas.style.cursor = index === null ? "grab" : "pointer";
    this.requestDraw();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { x } = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      // A trackpad pinch on macOS reports ctrlKey with small deltas; ⌘+scroll, and Ctrl+wheel on
      // Linux (whole notches), need a gentler curve.
      const pinch = e.ctrlKey && IS_MAC;
      const factor = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.002));
      this.setViewNow(zoomAtX(this.view, factor, x, this.currentData(), this.width));
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      this.setViewNow({ ...this.view, t0: this.view.t0 + dx / this.view.zx, ty: this.view.ty - dy });
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (!this.active) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (hasModKey(e) && !e.altKey) {
      if (e.key === "=" || e.key === "+") this.zoomBy(ZOOM_STEP);
      else if (e.key === "-") this.zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") this.fit();
      else return;
      e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const current = this.selected;
    const goto = (next: number | null) => {
      if (next !== null) this.select(next);
      e.preventDefault();
    };

    if (e.key === "h" && performance.now() - this.pendingG < 600) {
      this.pendingG = 0;
      return goto(0);
    }

    switch (e.key) {
      case "j": // older commit
        return goto(current === null ? 0 : Math.min(this.index.length - 1, current + 1));
      case "k": // newer commit
        return goto(current === null ? 0 : Math.max(0, current - 1));
      case "h": // first parent
        return goto(current === null ? 0 : this.index.parentIndex(current));
      case "l": // child
        return goto(current === null ? 0 : this.index.childIndex(current));
      case "Escape":
        this.select(null, false);
        return;
      case "g":
        this.pendingG = performance.now();
        return;
    }
  }
}
