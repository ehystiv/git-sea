import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CommitSummary } from "../../lib/bindings";
import { useWindowFocused } from "../../lib/windowFocus";
import type { Emphasis } from "../graph/emphasis";
import type { GraphCanvasHandle } from "../graph/GraphCanvas";
import type { GraphIndex } from "../graph/GraphIndex";
import { ZoomControls } from "../graph/ZoomControls";
import { TimelineController } from "./TimelineController";
import styles from "./TimelineCanvas.module.css";

interface TimelineCanvasProps {
  index: GraphIndex;
  /** Changes whenever the index gets new data. */
  version: number;
  /** Commit to show as selected when the canvas is created (e.g. after switching views). */
  initialSelectedId: string | null;
  /** False for a tab in the background: it keeps its state but ignores the keyboard. */
  active: boolean;
  /** Dots travelling along the links. */
  flow: boolean;
  /** Commits to keep bright while the rest fades; built for `index`. */
  emphasis: Emphasis | null;
  onSelect: (commit: CommitSummary | null) => void;
  /** Pixels on the right covered by the floating details panel; the canvas keeps its size. */
  insetRight: number;
}

/** The history on a time axis: one row per lane of the graph layout, newest commits on the right. */
export const TimelineCanvas = forwardRef<GraphCanvasHandle, TimelineCanvasProps>(function TimelineCanvas(
  { index, version, initialSelectedId, active, flow, emphasis, onSelect, insetRight },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement>(null);
  const focused = useWindowFocused();
  const controllerRef = useRef<TimelineController | null>(null);
  const onSelectRef = useRef(onSelect);
  const flowRef = useRef(flow);
  const emphasisRef = useRef(emphasis);
  const insetRef = useRef(insetRight);
  const pendingSelectRef = useRef<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useImperativeHandle(
    ref,
    () => ({
      selectById: (id) => {
        const at = index.indexOf(id);
        if (at !== null) controllerRef.current?.select(at);
      },
      zoomIn: () => controllerRef.current?.zoomBy(1.5),
      zoomOut: () => controllerRef.current?.zoomBy(1 / 1.5),
      fit: () => controllerRef.current?.fit(),
    }),
    [index],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const flowCanvas = flowCanvasRef.current;
    if (!canvas || !wrap || !flowCanvas) return;

    const controller = new TimelineController(canvas, index, {
      onSelect: (i) => onSelectRef.current(i === null ? null : (index.commits[i] ?? null)),
      onZoom: setZoom,
    });
    controllerRef.current = controller;
    controller.attachFlowCanvas(flowCanvas);
    controller.setFlow(flowRef.current);
    controller.setEmphasis(emphasisRef.current);
    controller.setInsetRight(insetRef.current);

    const observer = new ResizeObserver(() => {
      const { width, height } = wrap.getBoundingClientRect();
      controller.resize(width, height, window.devicePixelRatio || 1);
    });
    observer.observe(wrap);
    const { width, height } = wrap.getBoundingClientRect();
    controller.resize(width, height, window.devicePixelRatio || 1);
    controller.dataChanged();
    const initial = initialSelectedId === null ? null : index.indexOf(initialSelectedId);
    if (initial !== null) controller.select(initial);
    else pendingSelectRef.current = initialSelectedId;

    return () => {
      observer.disconnect();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [index]);

  useEffect(() => {
    controllerRef.current?.dataChanged();
    const pending = pendingSelectRef.current;
    const at = pending === null ? null : index.indexOf(pending);
    if (at !== null) {
      pendingSelectRef.current = null;
      controllerRef.current?.select(at);
    }
  }, [version, index]);

  useEffect(() => {
    controllerRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    flowRef.current = flow;
    controllerRef.current?.setFlow(flow);
  }, [flow]);

  useEffect(() => {
    emphasisRef.current = emphasis;
    controllerRef.current?.setEmphasis(emphasis);
  }, [emphasis]);

  useEffect(() => {
    insetRef.current = insetRight;
    controllerRef.current?.setInsetRight(insetRight);
  }, [insetRight]);

  // After the controller's creation, so a new one learns the focus too.
  useEffect(() => {
    controllerRef.current?.setFocused(focused);
  }, [focused, index]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <canvas ref={flowCanvasRef} className={styles.flow} aria-hidden="true" />
      <ZoomControls
        zoom={zoom}
        onFit={() => controllerRef.current?.fit()}
        onZoomIn={() => controllerRef.current?.zoomBy(1.5)}
        onZoomOut={() => controllerRef.current?.zoomBy(1 / 1.5)}
      />
    </div>
  );
});
