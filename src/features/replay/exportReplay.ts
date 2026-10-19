import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { Messages } from "../../lib/i18n";
import { RenderCache } from "../graph/draw";
import { drawReplayFrame, type ReplaySource } from "./renderReplay";
import { GIF_FPS, gifFrames, gifSize, replayLength, type ReplayPlan } from "./replay";

export type VideoFormat = { mime: string; format: "Mp4" | "Webm"; extension: "mp4" | "webm" };

/** The video format this webview can record a canvas in (MP4 on macOS, WebM elsewhere), or null. */
export function videoFormat(): VideoFormat | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  const candidates: VideoFormat[] = [
    { mime: "video/mp4;codecs=avc1", format: "Mp4", extension: "mp4" },
    { mime: "video/mp4", format: "Mp4", extension: "mp4" },
    { mime: "video/webm;codecs=vp9", format: "Webm", extension: "webm" },
    { mime: "video/webm", format: "Webm", extension: "webm" },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

/** Lets the page paint and the user cancel between pieces of a long export. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Draws every frame of the replay off screen and encodes them as a looping GIF. The colours come
 * from the last frame (the whole history) and are shared by all frames, which keeps them steady
 * and the encoding quick. `onProgress` gets 0…1; `cancelled` is polled between frames.
 */
export async function encodeGif(
  source: ReplaySource,
  plan: ReplayPlan,
  title: string,
  m: Messages,
  onProgress: (progress: number) => void,
  cancelled: () => boolean,
): Promise<Blob | null> {
  const size = gifSize(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const cache = new RenderCache();
  const length = replayLength(plan.durationMs);
  const frames = gifFrames(length);
  const read = (ms: number) => {
    drawReplayFrame(ctx, source, plan, cache, ms, size.scale, title, m);
    return ctx.getImageData(0, 0, size.width, size.height).data;
  };

  const palette = quantize(read(length), 256);
  const gif = GIFEncoder();
  const delay = Math.round(1000 / GIF_FPS);
  for (let frame = 0; frame < frames; frame++) {
    if (cancelled()) return null;
    const ms = (frame / Math.max(1, frames - 1)) * length;
    gif.writeFrame(applyPalette(read(ms), palette), size.width, size.height, { palette, delay, repeat: 0 });
    if (frame % 4 === 0) {
      onProgress(frame / frames);
      await breathe();
    }
  }
  gif.finish();
  onProgress(1);
  return new Blob([gif.bytesView().slice()], { type: "image/gif" });
}

/**
 * Records `canvas` while `play` draws the replay on it in real time, as a video. Resolves when
 * `play` does; null when recording fails or is cancelled.
 */
export async function recordVideo(canvas: HTMLCanvasElement, format: VideoFormat, play: () => Promise<boolean>): Promise<Blob | null> {
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(250);
  const finished = await play();
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  return finished && chunks.length > 0 ? new Blob(chunks, { type: format.mime.split(";")[0] }) : null;
}
