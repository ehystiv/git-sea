import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button/Button";
import { commands } from "../../lib/bindings";
import { formatCount, splitPath } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { RenderCache } from "../graph/draw";
import { blobToBase64 } from "../graph/snapshot";
import type { GraphIndex } from "../graph/GraphIndex";
import type { ReplayChoice } from "./choices";
import { encodeGif, recordVideo, videoFormat } from "./exportReplay";
import { drawReplayFrame, type ReplaySource } from "./renderReplay";
import { loadReplayIndex } from "./replayIndex";
import { defaultSpeed, durationFor, formatClock, GIF_MAX_MS, replayLength, SPEEDS, type ReplayPlan, type Speed } from "./replay";
import styles from "./ReplayPanel.module.css";


interface ReplayPanelProps {
  sessionId: string;
  /** The graph as it is on screen; its whole history is the replay without an end commit. */
  source: ReplaySource;
  /** The view is the topology: a history loaded for an end commit is compressed the same way. */
  compressed: boolean;
  ends: ReplayChoice[];
  starts: ReplayChoice[];
  /** Keys of the choices picked at first. */
  initialEnd: string;
  initialStart: string;
  /** Written in the corner of every frame (the repository's name). */
  title: string;
  /** Name of the saved file, without the extension. */
  fileBase: string;
  onClose: () => void;
  /** A short message for the user: saved, failed. */
  onNotice: (text: string) => void;
  /** CSS pixels on the right covered by the details panel. */
  insetRight: number;
}

/**
 * Plays the history growing commit by commit over the graph, at the zoom and height the graph
 * had, from a start commit to an end commit, and saves it as a GIF or a video.
 */
export function ReplayPanel({ sessionId, source: initial, compressed, ends, starts, initialEnd, initialStart, title, fileBase, onClose, onNotice, insetRight }: ReplayPanelProps) {
  const m = useT();
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The replay covers the whole view and follows its size; the camera works in the visible part.
  const [area, setArea] = useState({ width: initial.width + insetRight, height: initial.height });

  // The end: the whole history on screen, or the history of one commit, loaded on demand.
  const [endKey, setEndKey] = useState(initialEnd);
  const [startKey, setStartKey] = useState(initialStart);
  const end = ends.find((c) => c.key === endKey) ?? ends[0] ?? null;
  const startChoice = starts.find((c) => c.key === startKey) ?? starts[0] ?? null;
  const loaded = useRef(new Map<string, GraphIndex>());
  const [graph, setGraph] = useState<GraphIndex | null>(end?.commit ? null : initial.index);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    const commit = end?.commit ?? null;
    setLoadFailed(false);
    if (commit === null) return setGraph(initial.index);
    const known = loaded.current.get(commit);
    if (known) return setGraph(known);
    let active = true;
    setGraph(null);
    loadReplayIndex(sessionId, commit, compressed)
      .then((index) => {
        loaded.current.set(commit, index);
        if (active) setGraph(index);
      })
      .catch((error: unknown) => {
        console.warn("could not load the history to replay", error);
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [end?.commit, sessionId, compressed, initial.index]);

  const index = graph ?? initial.index;
  // The start: its column in the history replayed, or the oldest commit. A start outside that
  // history (not an ancestor of the end) cannot be used.
  const startAt = startChoice?.commit ? index.indexOf(startChoice.commit) : Math.max(0, index.length - 1);
  const startOutside = startChoice?.commit != null && startAt === null && graph !== null;
  const start = startAt ?? Math.max(0, index.length - 1);
  const [speed, setSpeed] = useState<Speed>(() => defaultSpeed(start));
  const plan: ReplayPlan = useMemo(() => ({ start, durationMs: durationFor(start, speed) }), [start, speed]);
  const durationMs = plan.durationMs;

  const source = useMemo(
    () => ({ ...initial, index, width: Math.max(1, area.width - insetRight), height: Math.max(1, area.height) }),
    [initial, index, area, insetRight],
  );
  const cache = useMemo(() => new RenderCache(), []);

  const [ms, setMs] = useState(0);
  const msRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [busy, setBusy] = useState<{ kind: "gif" | "video"; progress: number } | null>(null);
  // While a video is recorded the canvas keeps its size: the recording would change size too.
  const recording = busy?.kind === "video";
  const pendingArea = useRef<{ width: number; height: number } | null>(null);
  const recordingRef = useRef(recording);
  useEffect(() => {
    recordingRef.current = recording;
    if (!recording && pendingArea.current) {
      setArea(pendingArea.current);
      pendingArea.current = null;
    }
  }, [recording]);
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const measure = () => {
      const next = { width: overlay.clientWidth, height: overlay.clientHeight };
      if (next.width <= 0 || next.height <= 0) return;
      if (recordingRef.current) pendingArea.current = next;
      else setArea((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);
  const cancelRef = useRef(false);
  const video = useMemo(() => videoFormat(), []);
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const length = replayLength(durationMs);
  const ready = graph !== null;

  const paint = useCallback(
    (at: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) drawReplayFrame(ctx, source, plan, cache, at, scale, title, m, area.width);
    },
    [source, plan, cache, scale, title, m, area.width],
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

  // Another start, end or pace: back to the beginning.
  const planKey = `${endKey}|${startKey}|${speed}|${ready}`;
  const shownPlan = useRef(planKey);
  useEffect(() => {
    if (shownPlan.current === planKey) return;
    shownPlan.current = planKey;
    seek(0);
  }, [planKey, seek]);

  useEffect(() => {
    if (!playing || busy || !ready) return;
    if (msRef.current >= length) seek(0);
    void playThrough().then((finished) => {
      if (finished) setPlaying(false);
    });
    // Only this playback: an export may have started its own in the meantime.
    const own = playRef.current;
    return () => {
      if (playRef.current === own) own?.stop();
    };
  }, [playing, busy, ready, length, playThrough, seek]);

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
      const blob = await encodeGif(source, plan, title, m, (progress) => setBusy({ kind: "gif", progress }), () => cancelRef.current);
      await save(blob, "gif", "Gif");
    } catch (error) {
      console.warn("GIF export failed", error);
      onNotice(m.replay.failed);
    } finally {
      setBusy(null);
    }
  }, [source, plan, title, m, save, onNotice]);

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
    <div ref={overlayRef} className={styles.overlay} role="dialog" aria-label={m.replay.title}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={Math.round(area.width * scale)}
        height={Math.round(area.height * scale)}
        style={{ width: area.width, height: area.height }}
      />
      <div className={styles.bar} style={{ left: source.width / 2 }}>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.icon}
            disabled={busy !== null || !ready}
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
            value={Math.min(ms, length)}
            disabled={busy !== null || !ready}
            aria-label={m.replay.position}
            onChange={(event) => {
              setPlaying(false);
              seek(Number(event.target.value));
            }}
          />
          <span className={styles.clock}>
            {formatClock(Math.min(ms, length))} / {formatClock(length)}
          </span>
          <button type="button" className={styles.icon} aria-label={m.replay.close} title={`${m.replay.close} (Esc)`} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>{m.replay.from}</span>
            <select value={startChoice?.key ?? ""} disabled={busy !== null} onChange={(event) => setStartKey(event.target.value)}>
              {starts.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{m.replay.to}</span>
            <select value={end?.key ?? ""} disabled={busy !== null} onChange={(event) => setEndKey(event.target.value)}>
              {ends.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>{m.replay.speed}</span>
            <select value={speed} disabled={busy !== null} onChange={(event) => setSpeed(Number(event.target.value) as Speed)}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {m.replay.perSecond(s)}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.note} title={startOutside ? m.replay.startOutside : undefined}>
            {!ready ? (loadFailed ? m.replay.loadFailed : m.replay.loading) : startOutside ? m.replay.startOutside : m.replay.commitsIn(formatCount(start), formatClock(durationMs))}
          </span>
          <span className={styles.actions}>
          {busy ? (
            <>
              <span className={styles.progress}>
                {busy.kind === "gif" ? m.replay.encodingGif(Math.round(busy.progress * 100)) : m.replay.recording(formatClock(ms), formatClock(length))}
              </span>
              <Button variant="ghost" onClick={cancel}>
                {m.replay.cancel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                disabled={!ready || length > GIF_MAX_MS}
                onClick={() => void exportGif()}
                title={length > GIF_MAX_MS ? m.replay.gifTooLong(formatClock(GIF_MAX_MS)) : m.replay.gifTitle}
              >
                {m.replay.saveGif}
              </Button>
              {video && (
                <Button variant="ghost" disabled={!ready} onClick={() => void exportVideo()} title={m.replay.videoTitle(formatClock(length))}>
                  {m.replay.saveVideo}
                </Button>
              )}
            </>
          )}
          </span>
        </div>
      </div>
    </div>
  );
}
