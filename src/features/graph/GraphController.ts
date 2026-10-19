import { hasModKey, IS_MAC } from "../../lib/platform";
import { snapshotCanvas, toPng } from "./snapshot";
import { BOB_MS, RIPPLE_MS } from "./bob";
import { THEME_CHANGED } from "../../lib/theme";
import { COLUMN_W, LANE_H } from "./constants";
import { describeMarker } from "../ci/markers";
import { hitCi, type CiScene } from "./ciDraw";
import { draw, hitTest, hitWorktree, RenderCache, type View, type WorktreeMarker } from "./draw";
import type { Emphasis } from "./emphasis";
import { drawFlow, FlowOverlay, type FlowFrame } from "./flow";
import type { GraphIndex, ReplaceMotion } from "./GraphIndex";
import { ARRIVAL, arrivalDuration, buildArrival, buildMorph, morphPositions, type Morph } from "./morph";
import type { MinimapFrame } from "./MinimapOverlay";
import { readPalette, type Palette } from "./palette";
import { followColumn, newCommitIds, newestColumn, sideOf, type Side } from "./unseen";
import { anchorAtCentre, centeredOn, clampView, clampZoom, fitView, homeView, viewAfterReplace, zoomAt, type ViewAnchor } from "./view";

export interface GraphCallbacks {
  onSelect: (index: number | null) => void;
  onZoom: (zoom: number) => void;
  /** ⇧-click on a commit other than the selected one: compare the two. */
  onCompare?: (index: number) => void;
  /** Right-click on a commit; `x` and `y` are in the window (client coordinates). */
  onContextMenu?: (index: number, x: number, y: number) => void;
  /** A node standing for several commits was clicked; the argument is its newest commit's id. */
  onExpandGroup?: (id: string) => void;
  /** An already selected commit inside an opened run was clicked; the argument is the run's newest commit's id. */
  onCollapseGroup?: (id: string) => void;
  /** The badge of local changes was clicked. */
  onOpenWorktree?: () => void;
  /** A CI marker was clicked; the argument is its commit's id. */
  onOpenCi?: (id: string) => void;
  /** A node was clicked and pushed into the water; where it is on screen (for the sea). */
  onPoke?: (point: { x: number; y: number }) => void;
  /** New commits arrived; where they are on screen (for the sea). */
  onNewCommits?: (points: Array<{ x: number; y: number }>) => void;
  /** New commits arrived off screen (how many, and which way); null once they were seen. */
  onUnseen?: (unseen: Unseen | null) => void;
}

export interface Unseen {
  count: number;
  side: Side;
}

interface Animation {
  from: View;
  to: View;
  start: number;
  duration: number;
}

interface RunningMorph {
  data: Morph;
  start: number;
  /** Reused every frame. */
  positions: Float64Array;
  /** The selected commit's column in `data.index`. */
  selected: number | null;
  /** Milliseconds the whole transition lasts, and the part of it the commits slide. */
  duration: number;
  slide: number;
  /** Reduced motion: an arrival without movement, the new commits only fade in. */
  gentle: boolean;
}

const DRAG_THRESHOLD = 4;
const MORPH_MS = 280;
/** Below this many pixels per column the motion would not be visible: no morph. */
const MORPH_MIN_COLUMN_PX = 6;
const ZOOM_STEP = 1.25;

/**
 * Owns the canvas: view state (pan and zoom), selection, input handling and the draw loop.
 * React only creates it, feeds it size changes and data notifications, and reads selection and
 * zoom through the callbacks. Keeping this out of React state avoids re-rendering at 60 fps.
 */
export class GraphController {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = new RenderCache();
  private palette: Palette;
  private view: View = { tx: 0, ty: 0, z: 1 };
  private width = 0;
  private height = 0;
  /** Pixels on the right covered by something floating above the canvas (the details panel). */
  private insetRight = 0;
  private dpr = 1;
  private selected: number | null = null;
  private hovered: number | null = null;
  private placed = false;
  private frame = 0;
  private animation: Animation | null = null;
  private drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private gestureStartZoom = 1;
  private pendingG = 0;
  private active = true;
  private flow = false;
  /** Canvas the dots move on; without one (profiling) they are drawn with the graph. */
  private flowOverlay: FlowOverlay | null = null;
  /** The links of the last frame drawn, for the dots. */
  private flowFrame: FlowFrame | null = null;
  /** Something in the graph changed since the last frame: it must be drawn again. */
  private dirty = true;
  /** The window has the focus: things keep moving only then. */
  private focused = true;
  private emphasis: Emphasis | null = null;
  private worktree: WorktreeMarker | null = null;
  private bookmarks: ReadonlySet<string> = new Set();
  /** The node clicked last, bobbing like a float, and when it was clicked. */
  private bobbing: { id: string; start: number } | null = null;
  private ci: CiScene | null = null;
  private overBadge = false;
  private anchor: ViewAnchor | null = null;
  private morphFrom: { index: GraphIndex; tx: number; motion: ReplaceMotion } | null = null;
  private morph: RunningMorph | null = null;
  private selectedBeforeReplace: string | null = null;
  /** The history before a reload, to tell which commits it brought. */
  private arrivalFrom: GraphIndex | null = null;
  /** Ids of new commits not seen yet (they arrived off screen), and what was last reported. */
  private unseen: string[] = [];
  /** After a reload, move to HEAD when it changed or else to the newest new commit. */
  private follow = true;
  private unseenReported: Unseen | null = null;
  private frameListeners: Array<(frame: MinimapFrame<View>) => void> = [];
  private readonly disposers: Array<() => void> = [];

  /** Milliseconds the last frames took to issue their drawing commands (for profiling). */
  readonly frameTimes: number[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly index: GraphIndex,
    private readonly callbacks: GraphCallbacks,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.palette = readPalette();
    this.attach();
    this.disposers.push(
      index.onReplace({
        before: (motion) => this.beforeReplace(motion),
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

  /** Inactive controllers (background tabs) ignore the keyboard. */
  setActive(active: boolean): void {
    this.active = active;
    if (active) this.requestDraw();
  }

  /** Without the window's focus nothing moves on its own (the dots); it resumes with the focus. */
  setFocused(focused: boolean): void {
    this.focused = focused;
    if (focused) this.schedule();
  }

  /** Moves the dots on their own canvas, laid over this one with the same size. */
  attachFlowCanvas(canvas: HTMLCanvasElement): void {
    this.flowOverlay = new FlowOverlay(canvas);
    if (this.width > 0) this.flowOverlay.resize(this.width, this.height, this.dpr);
    this.requestDraw();
  }

  resize(width: number, height: number, dpr: number): void {
    // A hidden canvas reports no size; keep the last real one and the view as it is.
    if (width === 0 || height === 0) return;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (width === this.width && height === this.height && pixelWidth === this.canvas.width && pixelHeight === this.canvas.height) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // Resizing a canvas clears it: it is drawn again right away, before the browser shows the
    // frame, or every step of a resize (dragging the sidebar) would flash an empty canvas.
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    this.flowOverlay?.resize(width, height, dpr);
    if (this.placed) this.view = clampView(this.view, width, height, this.index);
    this.dirty = true;
    this.step(performance.now());
  }

  /**
   * Something floating above the canvas covers this many pixels on the right (the details panel).
   * The canvas keeps its size; centring, fitting and the first placement use the part left visible.
   */
  setInsetRight(px: number): void {
    this.insetRight = Math.max(0, px);
  }

  /** Width of the part of the canvas nothing floats over. */
  private get visibleWidth(): number {
    return Math.max(1, this.width - this.insetRight);
  }

  /** Call after the index changed (new chunk, refs, reset). */
  dataChanged(): void {
    if (this.index.length === 0) {
      this.placed = false;
      this.unseen = [];
      this.updateUnseen();
      this.selected = null;
      this.hovered = null;
      this.cache.described.clear();
      this.cache.wrapped.clear();
    } else if (!this.placed && this.width > 0) {
      this.view = homeView(this.index, this.visibleWidth, this.height);
      this.placed = true;
      this.callbacks.onZoom(this.view.z);
    }
    this.requestDraw();
  }

  /** The history is about to be swapped for a fresh one: remember what the user is looking at. */
  private beforeReplace(motion: ReplaceMotion): void {
    this.anchor = this.placed ? anchorAtCentre(this.index, this.view, this.visibleWidth) : null;
    this.morph = null;
    // Reduced motion still lets new commits fade in, but nothing slides.
    const allowed = motion === "arrival" || !prefersReducedMotion();
    this.morphFrom =
      motion !== "none" && allowed && this.placed && COLUMN_W * this.view.z >= MORPH_MIN_COLUMN_PX
        ? { index: this.index.snapshot(), tx: this.view.tx, motion }
        : null;
    this.arrivalFrom = motion === "arrival" && this.placed ? (this.morphFrom?.index ?? this.index.snapshot()) : null;
    this.selectedBeforeReplace = this.selected === null ? null : (this.index.commits[this.selected]?.id ?? null);
  }

  /** Puts the view and the selection back on the same commits, wherever they ended up. */
  private afterReplace(): void {
    this.animation = null;
    this.hovered = null;
    this.cache.described.clear();
    this.cache.wrapped.clear();
    if (this.placed) {
      this.view = clampView(viewAfterReplace(this.index, this.view, this.anchor), this.width, this.height, this.index);
      this.callbacks.onZoom(this.view.z);
    }
    if (this.selectedBeforeReplace !== null) {
      const at = this.index.indexOf(this.selectedBeforeReplace);
      this.selected = at;
      if (at === null) this.callbacks.onSelect(null);
    }
    this.anchor = null;
    this.selectedBeforeReplace = null;
    this.startMorph();
    if (this.arrivalFrom) {
      // Earlier unseen commits stay unseen; a commit can come back after being amended away.
      const added = newCommitIds(this.arrivalFrom, this.index);
      this.unseen = [...new Set([...added, ...this.unseen])];
      if (added.length > 0) this.callbacks.onNewCommits?.(this.screenPoints(added.slice(0, 20)));
      const target = this.follow ? followColumn(this.arrivalFrom, this.index, added) : null;
      this.arrivalFrom = null;
      if (target !== null) this.centerOn(target);
    }
    this.updateUnseen();
    this.requestDraw();
  }

  /** Where these commits are on screen, at their final place. */
  private screenPoints(ids: readonly string[]): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    for (const id of ids) {
      const column = this.index.indexOf(id);
      if (column === null) continue;
      const lane = this.index.rows[column]?.lane ?? 0;
      points.push({ x: -column * COLUMN_W * this.view.z + this.view.tx, y: lane * LANE_H * this.view.z + this.view.ty });
    }
    return points;
  }

  /** Forgets new commits once the view shows them, and tells which way they are until then. */
  private updateUnseen(): void {
    let next: Unseen | null = null;
    const column = this.unseen.length > 0 ? newestColumn(this.index, this.unseen) : null;
    const side = column === null ? null : sideOf(this.index, this.view, this.visibleWidth, this.height, column);
    if (side === null) this.unseen = [];
    else next = { count: this.unseen.filter((id) => this.index.indexOf(id) !== null).length, side };
    const last = this.unseenReported;
    if (next?.count === last?.count && next?.side === last?.side) return;
    this.unseenReported = next;
    this.callbacks.onUnseen?.(next);
  }

  /** Brings the newest of the new commits off screen into view. */
  showUnseen(): void {
    const column = newestColumn(this.index, this.unseen);
    if (column !== null) this.centerOn(column);
  }

  /**
   * Slides the commits from where they were to where the swap put them (a run opened or closed,
   * new commits pushed the others aside) and brings the new commits in.
   */
  private startMorph(): void {
    const from = this.morphFrom;
    this.morphFrom = null;
    if (!from) return;
    // The view moved to keep its anchor in place; the motion starts from what was on screen.
    const shift = (this.view.tx - from.tx) / (COLUMN_W * this.view.z);
    const arrival = from.motion === "arrival";
    const data = arrival ? buildArrival(from.index, this.index, shift) : buildMorph(from.index, this.index, shift);
    if (!data) return;
    const gentle = arrival && prefersReducedMotion();
    if (gentle) data.from.set(data.to);
    const selectedId = this.selected === null ? null : (this.index.commits[this.selected]?.id ?? null);
    this.morph = {
      data,
      start: performance.now(),
      positions: new Float64Array(data.index.length),
      selected: selectedId === null ? null : data.index.indexOf(selectedId),
      duration: arrival ? arrivalDuration(data.arrivals) : MORPH_MS,
      slide: arrival ? ARRIVAL.slide : MORPH_MS,
      gentle,
    };
  }

  // ---- commands --------------------------------------------------------------------------

  get zoom(): number {
    return this.view.z;
  }

  zoomBy(factor: number): void {
    this.animateTo(zoomAt(this.view, factor, this.visibleWidth / 2, this.height / 2));
  }

  fit(): void {
    if (this.index.length > 0) this.animateTo(fitView(this.index, this.visibleWidth, this.height));
  }

  /** Registers a listener called after every drawn frame; returns the unsubscribe function. */
  onFrame(listener: (frame: MinimapFrame<View>) => void): () => void {
    this.frameListeners.push(listener);
    return () => {
      this.frameListeners = this.frameListeners.filter((l) => l !== listener);
    };
  }

  /** Moves the view (clamped to the graph), with a short animation or at once. */
  goTo(view: View, animate: boolean): void {
    if (animate) this.animateTo(view);
    else this.setViewNow(view);
  }

  select(index: number | null, center = true): void {
    this.selected = index;
    this.callbacks.onSelect(index);
    if (index !== null && center) this.centerOn(index);
    this.requestDraw();
  }

  centerOn(index: number): void {
    const z = this.view.z < 0.35 ? 0.8 : this.view.z;
    this.animateTo(centeredOn(this.index, index, z, this.visibleWidth, this.height));
  }

  // ---- drawing ---------------------------------------------------------------------------

  /** Something in the graph changed: draw it again on the next frame. */
  requestDraw(): void {
    this.dirty = true;
    this.schedule();
  }

  /** A next frame, for the graph or only for the dots. */
  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.step(now);
    });
  }

  private step(now: number): void {
    const redraw = this.dirty;
    this.dirty = false;
    if (this.animation) {
      const { from, to, start, duration } = this.animation;
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.view = {
        tx: from.tx + (to.tx - from.tx) * e,
        ty: from.ty + (to.ty - from.ty) * e,
        z: from.z * Math.pow(to.z / from.z, e),
      };
      this.callbacks.onZoom(this.view.z);
      if (t >= 1) this.animation = null;
      else this.requestDraw();
    }
    // The graph is drawn only when something in it changed; the dots move on their own canvas.
    const moving = redraw ? this.render(now) : false;
    if (this.bobbing) {
      // One more frame after the end, to draw the node back in its place.
      if (now - this.bobbing.start >= Math.max(BOB_MS, RIPPLE_MS)) this.bobbing = null;
      this.requestDraw();
    }
    if (this.morph) {
      if (now - this.morph.start >= this.morph.duration) {
        this.morph = null;
        // Row numbers meant the other projection while it ran.
        this.cache.described.clear();
        this.cache.wrapped.clear();
      }
      this.requestDraw();
    }
    const animate = this.active && this.focused && !document.hidden;
    const overlay = this.flowOverlay;
    if (overlay) {
      overlay.setFrame(this.flow ? this.flowFrame : null);
      // Paused, the dots still follow a redrawn graph, but stay where they are.
      if ((redraw || animate) && overlay.tick(now, redraw) && animate) this.schedule();
    } else if (moving && animate) {
      this.requestDraw();
    }
  }

  /**
   * Draws a frame; returns true when there are dots moving along its links. Without a canvas of
   * their own (profiling), the dots are drawn here, over the graph.
   */
  render(time: number = performance.now()): boolean {
    if (this.width === 0 || this.height === 0) return false;
    const started = performance.now();
    const morph = this.morph;
    let morphScene = null;
    if (morph) {
      const elapsed = time - morph.start;
      const linear = Math.min(1, Math.max(0, elapsed / morph.slide));
      const t = linear < 0.5 ? 4 * linear ** 3 : 1 - (-2 * linear + 2) ** 3 / 2;
      const order = morph.data.order;
      morphScene = {
        positions: morphPositions(morph.data, t, morph.positions),
        fade: morph.data.fade,
        t,
        arrival: order ? { order, elapsed, gentle: morph.gentle } : null,
      };
    }
    const flow = draw(this.ctx, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      view: this.view,
      index: morph ? morph.data.index : this.index,
      palette: this.palette,
      cache: this.cache,
      selected: morph ? morph.selected : this.selected,
      hovered: morph ? null : this.hovered,
      flow: this.flow,
      emphasis: this.emphasis,
      morph: morphScene,
      worktree: this.worktree,
      ci: this.ci,
      bookmarks: this.bookmarks,
      bob: this.bobScene(time),
    });
    this.flowFrame = flow;
    const moving = flow !== null && (this.flowOverlay !== null || drawFlow(this.ctx, flow.links, { ...flow.style, time }) > 0);
    if (this.unseen.length > 0) this.updateUnseen();
    this.frameTimes.push(performance.now() - started);
    if (this.frameTimes.length > 300) this.frameTimes.shift();
    if (this.frameListeners.length > 0) {
      const frame = { view: this.view, width: this.width, height: this.height, palette: this.palette };
      this.frameListeners.forEach((listener) => listener(frame));
    }
    return moving;
  }

  /**
   * The view as it is on screen, without the part under the details panel and without the
   * pointer's hover or moving parts, as a PNG drawn sharper than the screen. Null when empty.
   */
  async snapshot(): Promise<Blob | null> {
    const width = this.visibleWidth;
    const height = this.height;
    if (width <= 0 || height <= 0 || this.index.length === 0) return null;
    const target = snapshotCanvas(width, height, this.dpr);
    if (!target) return null;
    const { ctx, canvas, scale } = target;
    draw(ctx, {
      width,
      height,
      dpr: scale,
      view: this.view,
      index: this.index,
      palette: this.palette,
      cache: this.cache,
      selected: this.selected,
      hovered: null,
      flow: false,
      emphasis: this.emphasis,
      morph: null,
      worktree: this.worktree,
      ci: this.ci,
      bookmarks: this.bookmarks,
      bob: null,
    });
    // On screen the background is another layer, under the transparent graph.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = this.palette.canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return toPng(canvas);
  }

  /** Where the bobbing node is in the frame drawn at `time`; none during a morph, whose columns move. */
  private bobScene(time: number): { column: number; ms: number } | null {
    const bobbing = this.bobbing;
    if (!bobbing || this.morph) return null;
    const column = this.index.indexOf(bobbing.id);
    return column === null ? null : { column, ms: time - bobbing.start };
  }

  /** Keeps these commits bright and fades the rest; null shows everything normally. */
  setEmphasis(emphasis: Emphasis | null): void {
    this.emphasis = emphasis;
    this.requestDraw();
  }

  /** Shows a badge with the number of locally changed files on a commit; null hides it. */
  setWorktree(marker: WorktreeMarker | null): void {
    this.worktree = marker;
    this.requestDraw();
  }

  /** Marks these commits with a bookmark ribbon. */
  setBookmarks(bookmarks: ReadonlySet<string>): void {
    this.bookmarks = bookmarks;
    this.requestDraw();
  }

  /** Shows CI runs and the places a workflow would start; null hides them. */
  setCi(ci: CiScene | null): void {
    this.ci = ci;
    this.requestDraw();
  }

  /** Switches the dots travelling along the links on or off. */
  setFollow(enabled: boolean): void {
    this.follow = enabled;
  }

  setFlow(enabled: boolean): void {
    this.flow = enabled;
    this.requestDraw();
  }

  /** Draws only the dots of the last frame, at `time` (used by profiling scripts). */
  renderFlow(time: number): void {
    this.flowOverlay?.setFrame(this.flow ? this.flowFrame : null);
    this.flowOverlay?.tick(time, true);
  }

  /** Sets the view directly (used by profiling scripts). */
  setView(view: View): void {
    this.animation = null;
    this.view = clampView(view, this.width, this.height, this.index);
    this.placed = true;
    this.requestDraw();
  }

  private animateTo(target: View, duration = 220): void {
    const to = clampView(target, this.width, this.height, this.index);
    this.animation = { from: this.view, to, start: performance.now(), duration };
    this.requestDraw();
  }

  private setViewNow(view: View): void {
    this.animation = null;
    this.view = clampView(view, this.width, this.height, this.index);
    this.callbacks.onZoom(this.view.z);
    this.requestDraw();
  }

  private async loadFonts(): Promise<void> {
    try {
      await Promise.all([
        document.fonts.load(`600 12px ${this.palette.fontUi}`),
        document.fonts.load(`500 11px ${this.palette.fontUi}`),
        document.fonts.load(`11px ${this.palette.fontMono}`),
      ]);
      this.cache.wrapped.clear();
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
    on("contextmenu", (e) => {
      e.preventDefault();
      const { x, y } = this.local(e);
      const hit = hitTest(this.index, this.view, x, y);
      if (hit !== null) this.callbacks.onContextMenu?.(hit, e.clientX, e.clientY);
    });

    // Safari / WKWebView reports trackpad pinch as non-standard gesture events.
    const gestureStart = (e: Event) => {
      e.preventDefault();
      this.gestureStartZoom = this.view.z;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const { scale, clientX, clientY } = e as unknown as { scale: number; clientX: number; clientY: number };
      const rect = this.canvas.getBoundingClientRect();
      const factor = (this.gestureStartZoom * scale) / this.view.z;
      this.setViewNow(zoomAt(this.view, factor, clientX - rect.left, clientY - rect.top));
    };
    this.canvas.addEventListener("gesturestart", gestureStart);
    this.canvas.addEventListener("gesturechange", gestureChange);
    this.disposers.push(() => {
      this.canvas.removeEventListener("gesturestart", gestureStart);
      this.canvas.removeEventListener("gesturechange", gestureChange);
    });

    // Hidden, nothing moved; visible again, the dots pick up where they were.
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
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.animation = null;
    const { x, y } = this.local(e);
    this.drag = { x, y, tx: this.view.tx, ty: this.view.ty, moved: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y } = this.local(e);
    if (!this.drag) {
      const ci = hitCi(this.index, this.view, this.ci, x, y);
      const tooltip = ci && this.ci ? describeMarker(ci.marker, ci.slot, this.ci.workflows) : "";
      if (this.canvas.title !== tooltip) this.canvas.title = tooltip;
      const badge = ci !== null || hitWorktree(this.index, this.view, this.worktree, x, y);
      const hit = badge ? null : hitTest(this.index, this.view, x, y);
      if (badge !== this.overBadge) {
        this.overBadge = badge;
        this.canvas.style.cursor = badge || hit !== null ? "pointer" : "grab";
      }
      this.setHover(hit);
      return;
    }
    const dx = x - this.drag.x;
    const dy = y - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    this.drag.moved = true;
    this.canvas.style.cursor = "grabbing";
    this.setViewNow({ ...this.view, tx: this.drag.tx + dx, ty: this.drag.ty + dy });
  }

  private onPointerUp(e: PointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    this.canvas.style.cursor = this.hovered === null && !this.overBadge ? "grab" : "pointer";
    if (!drag || drag.moved) return;
    const { x, y } = this.local(e);
    if (hitWorktree(this.index, this.view, this.worktree, x, y)) {
      this.callbacks.onOpenWorktree?.();
      return;
    }
    const ci = hitCi(this.index, this.view, this.ci, x, y);
    if (ci) {
      const at = this.index.indexOf(ci.id);
      if (at !== null) this.select(at, false);
      this.callbacks.onOpenCi?.(ci.id);
      return;
    }
    const hit = hitTest(this.index, this.view, x, y);
    if (hit !== null && !e.shiftKey && !this.index.groups.has(hit) && !prefersReducedMotion()) {
      const id = this.index.commits[hit]?.id;
      if (id !== undefined) {
        this.bobbing = { id, start: performance.now() };
        const lane = this.index.rows[hit]?.lane ?? 0;
        this.callbacks.onPoke?.(this.worldToScreen(hit, lane));
      }
    }
    if (e.shiftKey && hit !== null && this.selected !== null && hit !== this.selected && this.callbacks.onCompare) {
      this.callbacks.onCompare(hit);
      return;
    }
    const wasSelected = hit !== null && hit === this.selected;
    this.select(hit, false);
    const commit = hit === null ? undefined : this.index.commits[hit];
    if (!commit) return;
    if (this.index.groups.has(hit ?? -1)) {
      this.callbacks.onExpandGroup?.(commit.id);
    } else if (wasSelected) {
      // A second click on a commit of an opened run closes the run again.
      const run = this.index.openRuns.get(commit.id);
      if (run !== undefined) this.callbacks.onCollapseGroup?.(run);
    }
  }

  private setHover(index: number | null): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.canvas.style.cursor = index === null ? "grab" : "pointer";
    this.requestDraw();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { x, y } = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      // A trackpad pinch on macOS reports ctrlKey with small deltas; ⌘+scroll, and Ctrl+wheel on
      // Linux (whole notches), need a gentler curve.
      const pinch = e.ctrlKey && IS_MAC;
      const factor = Math.exp(-e.deltaY * (pinch ? 0.01 : 0.002));
      this.setViewNow(zoomAt(this.view, factor, x, y));
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      this.setViewNow({ ...this.view, tx: this.view.tx - dx, ty: this.view.ty - dy });
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

    // `g h`: back to HEAD
    if (e.key === "h" && performance.now() - this.pendingG < 600) {
      this.pendingG = 0;
      return goto(0);
    }

    switch (e.key) {
      case "j": // older commit (to the left)
        return goto(current === null ? 0 : Math.min(this.index.length - 1, current + 1));
      case "k": // newer commit (to the right)
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

  /** Where the selected commit would be on screen; handy for tests and profiling. */
  worldToScreen(column: number, lane: number): { x: number; y: number } {
    return {
      x: -column * COLUMN_W * this.view.z + this.view.tx,
      y: lane * LANE_H * this.view.z + this.view.ty,
    };
  }

  clampedZoom(z: number): number {
    return clampZoom(z);
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
