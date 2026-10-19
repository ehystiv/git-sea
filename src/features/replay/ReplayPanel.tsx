import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button/Button";
import { commands } from "../../lib/bindings";
import { splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { RenderCache } from "../graph/draw";
import { blobToBase64 } from "../graph/snapshot";
import { encodeGif, recordVideo, videoFormat } from "./exportReplay";
import { drawReplayFrame, type ReplaySource } from "./renderReplay";
import { replayLength } from "./replay";
import styles from "./ReplayPanel.module.css";

/** The lengths a replay can have, in seconds. */
const DURATIONS = [10, 20, 40, 60] as const;

interface ReplayPanelProps {
  source: ReplaySource;
  /** Written in the corner of every frame (the repository's name). */
  title: string;
  /** Name of the saved file, without the extension. */
  fileBase: string;
  onClose: () => void;
  /** A short message for the user: saved, failed. */
  onNotice: (text: string) => void;
}

/**
 * Plays the history growing commit by commit over the graph, at the zoom and height the graph
 * had, and saves it as a GIF or a video.
 */
export function ReplayPanel({ source, title, fileBase, onClose, onNotice }: ReplayPanelProps) {
  const m = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useMemo(() => new RenderCache(), []);
  const [seconds, setSeconds] = useState<(typeof DURATIONS)[number]>(20);
  const durationMs = seconds * 1000;
  const length = replayLength(durationMs);
  const [ms, setMs] = useState(0);
  const msRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState<{ kind: "gif" | "video"; progress: number } | null>(null);
  const cancelRef = useRef(false);
  const video = useMemo(() => videoFormat(), []);
  const scale = Math.min(2, window.devicePixelRatio || 1);

  const paint = useCallback(
    (at: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawReplayFrame(ctx, source, cache, at, durationMs, scale, title, m);
    },
    [source, cache, durationMs, scale, title, m],
  );

  const seek = useCallback(
    (at: number) => {
      msRef.current = at;
      setMs(at);
      paint(at);
    },
    [paint],
  );

  useLayoutEffect(() => paint(msRef.current), [paint]);

  /** Plays from where it is to the end; resolves true at the end, false when stopped before. */
  const playRef = useRef<{ stop: () => void } | null>(null);
  const playThrough = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        let last = performance.now();
        let frame = 0;
        let stopped = false;
        const tick = (now: number) => {
          if (stopped) return;
          const at = Math.min(length, msRef.current + (now - last));
          last = now;
          seek(at);
          if (at >= length) {
            playRef.current = null;
            resolve(true);
            return;
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        playRef.current = {
          stop: () => {
            stopped = true;
            cancelAnimationFrame(frame);
            playRef.current = null;
            resolve(false);
          },
        };
      }),
    [length, seek],
  );

  useEffect(() => {
    if (!playing || busy) return;
    if (msRef.current >= length) seek(0);
    void playThrough().then((finished) => {
      if (finished) setPlaying(false);
    });
    // Only this playback: an export may have started its own in the meantime.
    const own = playRef.current;
    return () => {
      if (playRef.current === own) own?.stop();
    };
  }, [playing, busy, length, playThrough, seek]);

  const save = useCallback(
    async (blob: Blob | null, extension: string, format: "Gif" | "Mp4" | "Webm") => {
      if (!blob) return;
      const result = await commands.saveExport(`${fileBase}.${extension}`, await blobToBase64(blob), format).catch(() => null);
      if (result?.status !== "ok") onNotice(m.replay.failed);
      else if (result.data) onNotice(m.export.saved(splitPath(result.data)[1]));
    },
    [fileBase, onNotice, m],
  );

  const exportGif = useCallback(async () => {
    setPlaying(false);
    cancelRef.current = false;
    setBusy({ kind: "gif", progress: 0 });
    try {
      const blob = await encodeGif(source, durationMs, title, m, (progress) => setBusy({ kind: "gif", progress }), () => cancelRef.current);
      await save(blob, "gif", "Gif");
    } catch (error) {
      console.warn("GIF export failed", error);
      onNotice(m.replay.failed);
    } finally {
      setBusy(null);
    }
  }, [source, durationMs, title, m, save, onNotice]);

  const exportVideo = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    setPlaying(false);
    playRef.current?.stop();
    cancelRef.current = false;
    setBusy({ kind: "video", progress: 0 });
    seek(0);
    try {
      // Recorded in real time, from the start, on the canvas on screen.
      const blob = await recordVideo(canvas, video, async () => {
        const finished = await playThrough();
        return finished && !cancelRef.current;
      });
      await save(blob, video.extension, video.format);
    } catch (error) {
      console.warn("video export failed", error);
      onNotice(m.replay.failed);
    } finally {
      setBusy(null);
    }
  }, [video, seek, playThrough, save, onNotice, m]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    playRef.current?.stop();
  }, []);

  // Escape stops an export, or else closes the replay.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (busy) cancel();
        else onClose();
      } else if (event.key === " " && !busy && (event.target as HTMLElement | null)?.tagName !== "BUTTON") {
        event.preventDefault();
        setPlaying((on) => !on);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, cancel, onClose]);

  return (
    <div className={styles.overlay} style={{ width: source.width, height: source.height }} role="dialog" aria-label={m.replay.title}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={Math.round(source.width * scale)}
        height={Math.round(source.height * scale)}
        style={{ width: source.width, height: source.height }}
      />
      <div className={styles.bar}>
        <button
          type="button"
          className={styles.icon}
          disabled={busy !== null}
          aria-label={playing ? m.replay.pause : m.replay.play}
          title={`${playing ? m.replay.pause : m.replay.play} (␣)`}
          onClick={() => setPlaying((on) => !on)}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
            </svg>
          )}
        </button>
        <input
          type="range"
          className={styles.scrub}
          min={0}
          max={length}
          step={10}
          value={ms}
          disabled={busy !== null}
          aria-label={m.replay.position}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value));
          }}
        />
        <label className={styles.duration}>
          <span>{m.replay.duration}</span>
          <select value={seconds} disabled={busy !== null} onChange={(event) => setSeconds(Number(event.target.value) as (typeof DURATIONS)[number])}>
            {DURATIONS.map((s) => (
              <option key={s} value={s}>
                {m.replay.seconds(s)}
              </option>
            ))}
          </select>
        </label>
        {busy ? (
          <>
            <span className={styles.progress}>
              {busy.kind === "gif" ? m.replay.encodingGif(Math.round(busy.progress * 100)) : m.replay.recording}
            </span>
            <Button variant="ghost" onClick={cancel}>
              {m.replay.cancel}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => void exportGif()} title={m.replay.gifTitle}>
              {m.replay.saveGif}
            </Button>
            {video && (
              <Button variant="ghost" onClick={() => void exportVideo()} title={m.replay.videoTitle(seconds + 2)}>
                {m.replay.saveVideo}
              </Button>
            )}
            <button type="button" className={styles.icon} aria-label={m.replay.close} title={`${m.replay.close} (Esc)`} onClick={onClose}>
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}
