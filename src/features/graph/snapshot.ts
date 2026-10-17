/** Longest side of an exported image, in pixels; larger canvases fail in some webviews. */
export const MAX_SNAPSHOT_SIDE = 8192;

/** The scale an export of a `width` × `height` view is drawn at: sharp (2× at least), but bounded. */
export function snapshotScale(width: number, height: number, dpr: number): number {
  const wanted = Math.max(2, dpr);
  const longest = Math.max(width, height, 1);
  return Math.min(wanted, MAX_SNAPSHOT_SIDE / longest);
}

/** A canvas of the right size for an export, with its 2D context. */
export function snapshotCanvas(width: number, height: number, dpr: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; scale: number } | null {
  const scale = snapshotScale(width, height, dpr);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx, scale } : null;
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** The bytes of a blob as base64, to send them to the backend in one string. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}
