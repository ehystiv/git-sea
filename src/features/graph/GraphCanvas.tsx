import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CommitSummary } from "../../lib/bindings";
import { GraphController } from "./GraphController";
import type { GraphIndex } from "./GraphIndex";
import { ZoomControls } from "./ZoomControls";
import styles from "./GraphCanvas.module.css";

interface GraphCanvasProps {
  index: GraphIndex;
  /** Changes whenever the index gets new data. */
  version: number;
  /** Commit to show as selected when the canvas is created (e.g. after switching views). */
  initialSelectedId: string | null;
  /** False for a tab in the background: it keeps its state but ignores the keyboard. */
  active: boolean;
  onSelect: (commit: CommitSummary | null) => void;
}

export interface GraphCanvasHandle {
  /** Selects the commit and brings it to the centre of the view. */
  selectById: (id: string) => void;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { index, version, initialSelectedId, active, onSelect },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const onSelectRef = useRef(onSelect);
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
    }),
    [index],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const controller = new GraphController(canvas, index, {
      onSelect: (i) => onSelectRef.current(i === null ? null : (index.commits[i] ?? null)),
      onZoom: setZoom,
    });
    controllerRef.current = controller;

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

    return () => {
      observer.disconnect();
      controller.destroy();
      controllerRef.current = null;
    };
  }, [index]);

  useEffect(() => {
    controllerRef.current?.dataChanged();
  }, [version]);

  useEffect(() => {
    controllerRef.current?.setActive(active);
  }, [active]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <ZoomControls
        zoom={zoom}
        onFit={() => controllerRef.current?.fit()}
        onZoomIn={() => controllerRef.current?.zoomBy(1.25)}
        onZoomOut={() => controllerRef.current?.zoomBy(1 / 1.25)}
      />
    </div>
  );
});
