import { forwardRef } from "react";
import { DOCK_HANDLE } from "../dock/DockController";
import { useT } from "../../lib/i18n";
import { modShortcut } from "../../lib/platform";
import styles from "./ZoomControls.module.css";

interface ZoomControlsProps {
  zoom: number;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Whether the view moves to HEAD or to new commits after a reload; no button without `onToggleFollow`. */
  follow?: boolean;
  onToggleFollow?: () => void;
  /** Opens the export choices; the point is where to show them (window coordinates). */
  onExport?: (x: number, y: number) => void;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" } as const;

function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

/** Fit, zoom in and out, the zoom level and the export button; dragged by the dots on the left. */
export const ZoomControls = forwardRef<HTMLDivElement, ZoomControlsProps>(function ZoomControls({ zoom, onFit, onZoomIn, onZoomOut, follow = false, onToggleFollow, onExport }, ref) {
  const m = useT();
  return (
    <div ref={ref} className={styles.zoom} role="toolbar" aria-label="Zoom">
      <span className={styles.grip} {...{ [DOCK_HANDLE]: "" }} title={m.dock.move} aria-hidden="true">
        <svg viewBox="0 0 6 14" width="6" height="14" fill="currentColor">
          <circle cx="1.5" cy="2" r="1.2" />
          <circle cx="4.5" cy="2" r="1.2" />
          <circle cx="1.5" cy="7" r="1.2" />
          <circle cx="4.5" cy="7" r="1.2" />
          <circle cx="1.5" cy="12" r="1.2" />
          <circle cx="4.5" cy="12" r="1.2" />
        </svg>
      </span>
      <button type="button" aria-label={m.zoom.fit} title={`${m.zoom.fit} (${modShortcut("0")})`} onClick={onFit}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      <button type="button" aria-label={m.zoom.in} title={`${m.zoom.in} (${modShortcut("+")})`} onClick={onZoomIn}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M5 12h14M12 5v14" />
        </svg>
      </button>
      <button type="button" aria-label={m.zoom.out} title={`${m.zoom.out} (${modShortcut("−")})`} onClick={onZoomOut}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M5 12h14" />
        </svg>
      </button>
      {onToggleFollow && (
        <button
          type="button"
          className={styles.follow}
          aria-pressed={follow}
          aria-label={m.zoom.follow}
          title={`${m.zoom.follow}: ${follow ? m.zoom.on : m.zoom.off}`}
          onClick={onToggleFollow}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )}
      <span className={styles.pct}>{formatZoom(zoom)}</span>
      {onExport && (
        <button
          type="button"
          className={styles.export}
          aria-label={m.zoom.export}
          title={m.zoom.export}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onExport(rect.left, rect.top - 6);
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" {...stroke} strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m21 16-5-5-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
});
