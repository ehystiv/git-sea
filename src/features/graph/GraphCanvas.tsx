import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CommitSummary } from "../../lib/bindings";
import { useT } from "../../lib/i18n";
import { useFollow } from "../../lib/follow";
import { useWindowFocused, windowFocused } from "../../lib/windowFocus";
import { GraphController, type Unseen } from "./GraphController";
import type { CiScene } from "./ciDraw";
import type { WorktreeMarker } from "./draw";
import type { Emphasis } from "./emphasis";
import type { GraphIndex } from "./GraphIndex";
import { Minimap } from "./MinimapOverlay";
import { SeaLayer } from "../sea/SeaLayer";
import { MINIMAP_H, MINIMAP_W, graphMinimap } from "./minimapMath";
import { ZoomControls } from "./ZoomControls";
import { DOCK_HANDLE } from "../dock/DockController";
import { useDockedWidgets } from "../dock/useDockedWidgets";
import styles from "./GraphCanvas.module.css";
import minimapStyles from "./MinimapOverlay.module.css";

interface GraphCanvasProps {
  index: GraphIndex;
  /** Changes whenever the index gets new data. */
  version: number;
  /** Commit to show as selected when the canvas is created (e.g. after switching views). */
  initialSelectedId: string | null;
  /** False for a tab in the background: it keeps its state, stands still and ignores the keyboard. */
  active: boolean;
  /** False for the view of a split that does not have the keyboard. */
  keyboard: boolean;
  /** The overview in a corner; left out when two repositories share the window. */
  minimap: boolean;
  /** Dots travelling along the links. */
  flow: boolean;
  /** Commits to keep bright while the rest fades; built for `index`. */
  emphasis: Emphasis | null;
  onSelect: (commit: CommitSummary | null) => void;
  /** A commit was clicked, even the selected one: show its details. */
  onClickCommit?: (commit: CommitSummary) => void;
  /** ⇧-click on another commit than the selected one. */
  onCompare?: (commit: CommitSummary) => void;
  /** Right-click on a commit, at window coordinates. */
  onContextMenu?: (commit: CommitSummary, x: number, y: number) => void;
  /** Compressed view: a node standing for several commits was clicked. */
  onExpandGroup?: (id: string) => void;
  /** Compressed view: a selected commit of an opened run was clicked again. */
  onCollapseGroup?: (id: string) => void;
  /** Local changes to show as a badge on their commit; null for none. */
  worktree: WorktreeMarker | null;
  /** Ids of the bookmarked commits. */
  bookmarks: ReadonlySet<string>;
  /** The badge of local changes was clicked. */
  onOpenWorktree?: () => void;
  /** CI runs and hypothetical workflow starts to show on the links; null for none. */
  ci: CiScene | null;
  /** A CI marker was clicked. */
  onOpenCi?: (id: string) => void;
  /** Pixels on the right covered by the floating details panel; the canvas keeps its size. */
  insetRight: number;
  /** Fish swimming in the background. */
  sea: boolean;
  /** The export button next to the zoom was pressed, at window coordinates. */
  onExport?: (x: number, y: number) => void;
}

const ARROW = { left: "←", right: "→", up: "↑", down: "↓" } as const;

export interface GraphCanvasHandle {
  /** Selects the commit and brings it to the centre of the view. */
  selectById: (id: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Shows the whole history. */
  fit: () => void;
  /** The visible part of the view as a PNG; null when there is nothing to draw. */
  snapshot: () => Promise<Blob | null>;
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  { index, version, initialSelectedId, active, keyboard, minimap: showMinimap, flow, emphasis, onSelect, onClickCommit, onCompare, onContextMenu, onExpandGroup, onCollapseGroup, worktree, bookmarks, onOpenWorktree, ci, onOpenCi, insetRight, sea, onExport },
  ref,
) {
  const m = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seaCanvasRef = useRef<HTMLCanvasElement>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement>(null);
  const focused = useWindowFocused();
  const follow = useFollow((s) => s.enabled);
  const toggleFollow = useFollow((s) => s.toggle);
  const followRef = useRef(follow);
  const seaRef = useRef<SeaLayer | null>(null);
  const seaEnabledRef = useRef(sea);
  const activeRef = useRef(active);
  const keyboardRef = useRef(keyboard);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapBoxRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  useDockedWidgets(wrapRef, { minimap: minimapBoxRef, zoom: zoomRef }, insetRight);
  const controllerRef = useRef<GraphController | null>(null);
  const onSelectRef = useRef(onSelect);
  const onClickCommitRef = useRef(onClickCommit);
  const onCompareRef = useRef(onCompare);
  const onContextMenuRef = useRef(onContextMenu);
  const flowRef = useRef(flow);
  const emphasisRef = useRef(emphasis);
  const onExpandRef = useRef(onExpandGroup);
  const onCollapseRef = useRef(onCollapseGroup);
  const worktreeRef = useRef(worktree);
  const bookmarksRef = useRef(bookmarks);
  const insetRef = useRef(insetRight);
  const onOpenWorktreeRef = useRef(onOpenWorktree);
  const ciRef = useRef(ci);
  const onOpenCiRef = useRef(onOpenCi);
  const [zoom, setZoom] = useState(1);
  const [unseen, setUnseen] = useState<Unseen | null>(null);
  /** A selection that could not be applied yet because the (derived) index was still empty. */
  const pendingSelectRef = useRef<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onClickCommitRef.current = onClickCommit;
    onCompareRef.current = onCompare;
    onContextMenuRef.current = onContextMenu;
    onExpandRef.current = onExpandGroup;
    onCollapseRef.current = onCollapseGroup;
    onOpenWorktreeRef.current = onOpenWorktree;
    onOpenCiRef.current = onOpenCi;
  }, [onSelect, onClickCommit, onCompare, onContextMenu, onExpandGroup, onCollapseGroup, onOpenWorktree, onOpenCi]);

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
      snapshot: () => controllerRef.current?.snapshot() ?? Promise.resolve(null),
    }),
    [index],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const minimapCanvas = minimapRef.current;
    const seaCanvas = seaCanvasRef.current;
    const flowCanvas = flowCanvasRef.current;
    if (!canvas || !wrap || !minimapCanvas || !seaCanvas || !flowCanvas) return;

    const seaLayer = new SeaLayer(seaCanvas);
    seaRef.current = seaLayer;
    seaLayer.setEnabled(seaEnabledRef.current);
    seaLayer.setActive(activeRef.current && windowFocused());

    const controller = new GraphController(canvas, index, {
      onSelect: (i) => onSelectRef.current(i === null ? null : (index.commits[i] ?? null)),
      onZoom: setZoom,
      onClickCommit: (i) => {
        const commit = index.commits[i];
        if (commit) onClickCommitRef.current?.(commit);
      },
      onCompare: (i) => {
        const commit = index.commits[i];
        if (commit) onCompareRef.current?.(commit);
      },
      onContextMenu: (i, x, y) => {
        const commit = index.commits[i];
        if (commit) onContextMenuRef.current?.(commit, x, y);
      },
      onExpandGroup: (id) => onExpandRef.current?.(id),
      onCollapseGroup: (id) => onCollapseRef.current?.(id),
      onOpenWorktree: () => onOpenWorktreeRef.current?.(),
      onOpenCi: (id) => onOpenCiRef.current?.(id),
      onUnseen: setUnseen,
      onNewCommits: (points) => seaLayer.scare(points),
      // The fish near a clicked node dart away from the ripples.
      onPoke: (point) => seaLayer.scare([point]),
    });
    controllerRef.current = controller;
    controller.attachFlowCanvas(flowCanvas);
    controller.setFlow(flowRef.current);
    controller.setKeyboard(keyboardRef.current);
    controller.setFollow(followRef.current);
    controller.setEmphasis(emphasisRef.current);
    controller.setWorktree(worktreeRef.current);
    controller.setBookmarks(bookmarksRef.current);
    controller.setCi(ciRef.current);
    controller.setInsetRight(insetRef.current);
    const minimap = new Minimap(minimapCanvas, graphMinimap(index), controller);
    const stopFollowing = controller.onFrame((frame) => seaLayer.follow(frame.view));
    const pointer = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      seaLayer.setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const leave = () => seaLayer.setPointer(null);
    wrap.addEventListener("pointermove", pointer);
    wrap.addEventListener("pointerleave", leave);

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      controller.resize(width, height, window.devicePixelRatio || 1);
      seaLayer.resize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    controller.dataChanged();
    const initial = initialSelectedId === null ? null : index.indexOf(initialSelectedId);
    if (initial !== null) controller.select(initial);
    else pendingSelectRef.current = initialSelectedId;

    return () => {
      observer.disconnect();
      stopFollowing();
      wrap.removeEventListener("pointermove", pointer);
      wrap.removeEventListener("pointerleave", leave);
      seaLayer.destroy();
      seaRef.current = null;
      minimap.destroy();
      controller.destroy();
      controllerRef.current = null;
      setUnseen(null);
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
    activeRef.current = active;
    controllerRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    keyboardRef.current = keyboard;
    controllerRef.current?.setKeyboard(keyboard);
  }, [keyboard]);

  // After the controller's creation, so a new one (and its sea) learns the focus too.
  useEffect(() => {
    controllerRef.current?.setFocused(focused);
    seaRef.current?.setActive(active && focused);
  }, [active, focused, index]);

  useEffect(() => {
    seaEnabledRef.current = sea;
    seaRef.current?.setEnabled(sea);
  }, [sea]);

  useEffect(() => {
    flowRef.current = flow;
    controllerRef.current?.setFlow(flow);
  }, [flow]);

  useEffect(() => {
    followRef.current = follow;
    controllerRef.current?.setFollow(follow);
  }, [follow]);

  useEffect(() => {
    emphasisRef.current = emphasis;
    controllerRef.current?.setEmphasis(emphasis);
  }, [emphasis]);

  useEffect(() => {
    insetRef.current = insetRight;
    controllerRef.current?.setInsetRight(insetRight);
  }, [insetRight]);

  useEffect(() => {
    worktreeRef.current = worktree;
    controllerRef.current?.setWorktree(worktree);
  }, [worktree]);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
    controllerRef.current?.setBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    ciRef.current = ci;
    controllerRef.current?.setCi(ci);
  }, [ci]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <canvas ref={seaCanvasRef} className={styles.sea} aria-hidden="true" />
      <canvas ref={canvasRef} className={styles.canvas} />
      <canvas ref={flowCanvasRef} className={styles.flow} aria-hidden="true" />
      <div ref={minimapBoxRef} className={minimapStyles.box} hidden={!showMinimap}>
        <canvas
          ref={minimapRef}
          className={minimapStyles.minimap}
          style={{ width: MINIMAP_W, height: MINIMAP_H }}
          role="img"
          aria-label={m.graph.minimap}
          title={m.graph.minimapTitle}
        />
        <div className={minimapStyles.grip} {...{ [DOCK_HANDLE]: "" }} title={m.dock.move} aria-hidden="true" />
      </div>
      {unseen && (
        <button type="button" className={styles.unseen} onClick={() => controllerRef.current?.showUnseen()}>
          {unseen.side === "left" && <span aria-hidden="true">←</span>}
          {m.graph.newCommits(unseen.count)}
          {unseen.side !== "left" && <span aria-hidden="true">{ARROW[unseen.side]}</span>}
        </button>
      )}
      <ZoomControls
        ref={zoomRef}
        zoom={zoom}
        onFit={() => controllerRef.current?.fit()}
        onZoomIn={() => controllerRef.current?.zoomBy(1.25)}
        onZoomOut={() => controllerRef.current?.zoomBy(1 / 1.25)}
        follow={follow}
        onToggleFollow={toggleFollow}
        onExport={onExport}
      />
    </div>
  );
});
