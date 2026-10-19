// Types for the parts of gifenc (https://github.com/mattdesl/gifenc) the replay export uses.
declare module "gifenc" {
  export type Palette = number[][];

  export interface FrameOptions {
    palette?: Palette;
    /** Milliseconds this frame stays on screen. */
    delay?: number;
    /** -1 plays once, 0 forever, more than 0 that many times; read from the first frame. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: "rgb565" | "rgb444" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: "rgb565" | "rgb444" | "rgba4444"): Uint8Array;
}
