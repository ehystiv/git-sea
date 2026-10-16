import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CommitSummary } from "../../lib/bindings";
import { GraphController } from "./GraphController";
import type { Emphasis } from "./emphasis";
import type { GraphIndex } from "./GraphIndex";
import { Minimap } from "./MinimapOverlay";
import { MINIMAP_H, MINIMAP_W } from "./minimapMath";
import { ZoomControls } from "./ZoomControls";
import styles from "./GraphCanvas.module.css";
import minimapStyles from "./MinimapOverlay.module.css";

interface GraphCanvasProps {
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
  /** Compressed view: a node standing for several commits was clicked. */
  onExpandGroup?: (id: string) => void;
  /** Compressed view: a selected commit of an opened run was clicked again. */
  onCollapseGroup?: (id: string) => void;
}

export interface GraphCanvasHandle {
  /** Selects the commit and brings it to the centre of the view. */
  selectById: (id: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Shows the whole history. */
  fit: () => void;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { index, version, initialSelectedId, active, flow, emphasis, onSelect, onExpandGroup, onCollapseGroup },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const onSelectRef = useRef(onSelect);
  const flowRef = useRef(flow);
  const emphasisRef = useRef(emphasis);
  const onExpandRef = useRef(onExpandGroup);
  const onCollapseRef = useRef(onCollapseGroup);
  const [zoom, setZoom] = useState(1);
  /** A selection that could not be applied yet because the (derived) index was still empty. */
  const pendingSelectRef = useRef<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onExpandRef.current = onExpandGroup;
    onCollapseRef.current = onCollapseGroup;
  }, [onSelect, onExpandGroup, onCollapseGroup]);

  useImperativeHandle(
    ref,
    () => ({
      selectById: (id) => {
        const at = index.indexOf(id);
        if (at !== null) controllerRef.current?.select(at);
      },
      zoomIn: () => controllerRef.current?.zoomBy(1.25),
      zoomOut: () => controllerRef.current?.zoomBy(1 / 1.25),
      fit: () => controllerRef.current?.fit(),
    }),
    [index],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const minimapCanvas = minimapRef.current;
    if (!canvas || !wrap || !minimapCanvas) return;

    const controller = new GraphController(canvas, index, {
      onSelect: (i) => onSelectRef.current(i === null ? null : (index.commits[i] ?? null)),
      onZoom: setZoom,
      onExpandGroup: (id) => onExpandRef.current?.(id),
      onCollapseGroup: (id) => onCollapseRef.current?.(id),
    });
    controllerRef.current = controller;
    controller.setFlow(flowRef.current);
    controller.setEmphasis(emphasisRef.current);
    const minimap = new Minimap(minimapCanvas, index, controller);

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
      minimap.destroy();
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

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      <canvas
        ref={minimapRef}
        className={minimapStyles.minimap}
        style={{ width: MINIMAP_W, height: MINIMAP_H }}
        role="img"
        aria-label="Minimappa"
        title="Minimappa: clic o trascina per spostarti"
      />
      <ZoomControls
        zoom={zoom}
        onFit={() => controllerRef.current?.fit()}
        onZoomIn={() => controllerRef.current?.zoomBy(1.25)}
        onZoomOut={() => controllerRef.current?.zoomBy(1 / 1.25)}
      />
    </div>
  );
});
