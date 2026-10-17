import type { Rect } from "./minimapMath";
import { MINIMAP_H, MINIMAP_W } from "./minimapMath";
import type { Palette } from "./palette";

/** What the minimap needs to know about the main canvas each time it draws. */
export interface MinimapFrame<V> {
  view: V;
  width: number;
  height: number;
  palette: Palette;
}

/** The slice of a view controller the minimap talks to. */
export interface MinimapHost<V> {
  /** Registers a listener called after every main-canvas frame; returns the unsubscribe function. */
  onFrame: (listener: (frame: MinimapFrame<V>) => void) => () => void;
  /** Moves the main view (clamped by the host); `animate` is for clicks, dragging follows at once. */
  goTo: (view: V, animate: boolean) => void;
}

/** How one kind of view (graph, timeline) appears on the minimap. */
export interface MinimapModel<V> {
  /** Values that change when the picture must be painted again (new data). */
  version: () => readonly unknown[];
  /** Paints the whole history into a `MINIMAP_W` × `MINIMAP_H` context, cleared first. */
  paint: (ctx: CanvasRenderingContext2D, palette: Palette) => void;
  /** The part the main canvas shows; null when there is nothing to show. */
  viewport: (view: V, width: number, height: number) => Rect | null;
  /** The view with what is under the minimap point (x, y) in the middle of the screen. */
  centeredAt: (view: V, x: number, y: number, width: number, height: number) => V;
}

const sameVersion = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Overview of the whole history in a small canvas: the picture is painted once into an offscreen
 * layer (again only when the data, the pixel density or the theme change) and every frame just
 * copies it and draws the viewport rectangle on top. Click or drag to move the main view.
 */
export class Minimap<V> {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private frame: MinimapFrame<V> | null = null;
  private dpr = 0;
  private layerVersion: readonly unknown[] = [];
  private layerPalette: Palette | null = null;
  private dragging = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly model: MinimapModel<V>,
    private readonly host: MinimapHost<V>,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.layer = document.createElement("canvas");
    this.disposers.push(host.onFrame((frame) => this.draw(frame)));

    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (e: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(type, handler);
      this.disposers.push(() => canvas.removeEventListener(type, handler));
    };
    on("pointerdown", (e) => this.onPointerDown(e));
    on("pointermove", (e) => this.onPointerMove(e));
    on("pointerup", (e) => this.onPointerUp(e));
    on("pointercancel", (e) => this.onPointerUp(e));
  }

  destroy(): void {
    this.disposers.forEach((dispose) => dispose());
  }

  private draw(frame: MinimapFrame<V>): void {
    this.frame = frame;
    const dpr = window.devicePixelRatio || 1;
    this.ensureLayer(frame.palette, dpr);

    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.drawImage(this.layer, 0, 0, MINIMAP_W, MINIMAP_H);

    const rect = this.model.viewport(frame.view, frame.width, frame.height);
    if (!rect) return;
    ctx.fillStyle = frame.palette.accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = frame.palette.accent;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  private ensureLayer(palette: Palette, dpr: number): void {
    const version = this.model.version();
    if (dpr === this.dpr && palette === this.layerPalette && sameVersion(version, this.layerVersion)) return;

    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.canvas.width = Math.round(MINIMAP_W * dpr);
      this.canvas.height = Math.round(MINIMAP_H * dpr);
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
    }
    const layerCtx = this.layer.getContext("2d");
    if (layerCtx) {
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.model.paint(layerCtx, palette);
    }
    this.layerVersion = version;
    this.layerPalette = palette;
  }

  // ---- input -----------------------------------------------------------------------------

  private moveTo(e: PointerEvent, animate: boolean): void {
    const frame = this.frame;
    if (!frame || !this.model.viewport(frame.view, frame.width, frame.height)) return;
    const rect = this.canvas.getBoundingClientRect();
    this.host.goTo(this.model.centeredAt(frame.view, e.clientX - rect.left, e.clientY - rect.top, frame.width, frame.height), animate);
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    this.canvas.style.cursor = "grabbing";
    this.moveTo(e, true);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragging) this.moveTo(e, false);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = "pointer";
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }
}
