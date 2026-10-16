import { THEME_CHANGED } from "../../lib/theme";
import type { View } from "../graph/draw";
import { readPalette } from "../graph/palette";
import { createSea, drawSea, panSea, resizeSea, scareSea, stepSea, type Sea, type SeaColors } from "./sea";

/** About 30 frames a second: the fish are slow, and the sea should cost next to nothing. */
const FRAME_MS = 32;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Runs the sea on its own canvas, under the graph's. The graph only redraws when something in it
 * moves, so the fish never make it redraw. Swims only while enabled, in the active tab, with the
 * window visible; with reduced motion the fish are drawn once and stay still.
 */
export class SeaLayer {
  private readonly ctx: CanvasRenderingContext2D;
  private sea: Sea = createSea(0, 0);
  private colors: SeaColors;
  private width = 0;
  private height = 0;
  private enabled = true;
  private active = true;
  private frame = 0;
  private last = 0;
  private pointer: { x: number; y: number } | null = null;
  private lastView: View | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    this.ctx = ctx;
    this.colors = { ink: readPalette().text3 };
    const themeChanged = () => {
      this.colors = { ink: readPalette().text3 };
      this.redraw();
    };
    const visibility = () => this.update();
    window.addEventListener(THEME_CHANGED, themeChanged);
    document.addEventListener("visibilitychange", visibility);
    this.disposers.push(
      () => window.removeEventListener(THEME_CHANGED, themeChanged),
      () => document.removeEventListener("visibilitychange", visibility),
    );
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.disposers.forEach((dispose) => dispose());
  }

  /**
   * Always at 1× whatever the screen: faint, thin lines look the same, and a Retina canvas would
   * have four times the pixels to clear and compose thirty times a second.
   */
  resize(width: number, height: number): void {
    if (width === 0 || height === 0) return;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width);
    this.canvas.height = Math.round(height);
    this.sea = resizeSea(this.sea, width, height);
    this.redraw();
    this.update();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.redraw();
    this.update();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.update();
  }

  setPointer(pointer: { x: number; y: number } | null): void {
    this.pointer = pointer;
  }

  /** The graph's view after a frame: the sea drifts with its panning. Zooming moves nothing. */
  follow(view: View): void {
    const last = this.lastView;
    this.lastView = view;
    if (!last || last.z !== view.z) return;
    const dx = view.tx - last.tx;
    const dy = view.ty - last.ty;
    if (dx === 0 && dy === 0) return;
    panSea(this.sea, dx, dy);
    if (!this.running) this.redraw();
  }

  /** New commits showed up at these points: the fish nearby dart away. */
  scare(points: ReadonlyArray<{ x: number; y: number }>): void {
    if (this.running) scareSea(this.sea, points);
  }

  private get running(): boolean {
    return this.enabled && this.active && !document.hidden && !prefersReducedMotion() && this.width > 0;
  }

  private update(): void {
    if (!this.running) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    if (this.frame) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.frame = 0;
      if (!this.running) return;
      if (now - this.last >= FRAME_MS) {
        // A long pause (a background tab) would make the fish jump: cap the step.
        stepSea(this.sea, Math.min(0.1, (now - this.last) / 1000), { pointer: this.pointer });
        this.last = now;
        this.redraw();
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private redraw(): void {
    if (this.width === 0) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.enabled) drawSea(this.ctx, this.sea, this.colors);
    else this.ctx.clearRect(0, 0, this.width, this.height);
  }
}
