import type { View } from "./draw";
import type { GraphIndex } from "./GraphIndex";
import {
  drawMinimapGraph,
  MINIMAP_H,
  MINIMAP_W,
  minimapGeometry,
  viewCenteredAtMinimap,
  viewportRect,
  type MinimapGeometry,
} from "./minimapMath";
import type { Palette } from "./palette";

/** What the minimap needs to know about the main canvas each time it draws. */
export interface MinimapFrame {
  view: View;
  width: number;
  height: number;
  palette: Palette;
}

/** The slice of `GraphController` the minimap talks to. */
export interface MinimapHost {
  /** Registers a listener called after every main-canvas frame; returns the unsubscribe function. */
  onFrame: (listener: (frame: MinimapFrame) => void) => () => void;
  /** Moves the main view; `animate` is for clicks, dragging follows the pointer immediately. */
  goTo: (view: View, animate: boolean) => void;
  requestDraw: () => void;
}

/**
 * Overview of the whole history in a small canvas: the graph is painted once into an offscreen
 * layer (rebuilt only when the data, the size or the theme change) and every frame just copies it
 * and draws the viewport rectangle on top. Click or drag to move the main view.
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private geometry: MinimapGeometry;
  private frame: MinimapFrame | null = null;
  private dpr = 1;
  private layerKey = "";
  private layerPalette: Palette | null = null;
  private layerCommits: unknown = null;
  private dragging = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly index: GraphIndex,
    private readonly host: MinimapHost,
  ) {
    const ctx = canvas.getContext("2d");
    const layer = document.createElement("canvas");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.layer = layer;
    this.geometry = minimapGeometry(index);
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

  private draw(frame: MinimapFrame): void {
    this.frame = frame;
    const dpr = window.devicePixelRatio || 1;
    this.ensureLayer(frame.palette, dpr);

    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.drawImage(this.layer, 0, 0, MINIMAP_W, MINIMAP_H);
    if (this.index.length === 0) return;

    const rect = viewportRect(this.geometry, frame.view, frame.width, frame.height);
    ctx.fillStyle = frame.palette.accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = frame.palette.accent;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  }

  private ensureLayer(palette: Palette, dpr: number): void {
    const { index } = this;
    const key = `${index.length}:${index.maxLane}:${dpr}`;
    if (key === this.layerKey && palette === this.layerPalette && index.commits === this.layerCommits) return;

    if (dpr !== this.dpr || this.layer.width === 0) {
      this.dpr = dpr;
      this.canvas.width = Math.round(MINIMAP_W * dpr);
      this.canvas.height = Math.round(MINIMAP_H * dpr);
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
    }
    this.geometry = minimapGeometry(index);
    const layerCtx = this.layer.getContext("2d");
    if (layerCtx) {
      layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMinimapGraph(layerCtx, index, this.geometry, palette);
    }
    this.layerKey = key;
    this.layerPalette = palette;
    this.layerCommits = index.commits;
  }

  // ---- input -----------------------------------------------------------------------------

  private moveTo(e: PointerEvent, animate: boolean): void {
    const frame = this.frame;
    if (!frame || this.index.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const target = viewCenteredAtMinimap(
      this.geometry,
      frame.view,
      e.clientX - rect.left,
      e.clientY - rect.top,
      frame.width,
      frame.height,
    );
    this.host.goTo(target, animate);
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
