import { useT } from "../../lib/i18n";
import { modShortcut } from "../../lib/platform";
import styles from "./ZoomControls.module.css";

interface ZoomControlsProps {
  zoom: number;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Opens the export choices; the point is where to show them (window coordinates). */
  onExport?: (x: number, y: number) => void;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" } as const;

function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

export function ZoomControls({ zoom, onFit, onZoomIn, onZoomOut, onExport }: ZoomControlsProps) {
  const m = useT();
  return (
    <div className={styles.zoom} role="toolbar" aria-label="Zoom">
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
}
