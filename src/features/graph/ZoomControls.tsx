import { modShortcut } from "../../lib/platform";
import styles from "./ZoomControls.module.css";

interface ZoomControlsProps {
  zoom: number;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" } as const;

function formatZoom(zoom: number): string {
  const pct = zoom * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`;
}

export function ZoomControls({ zoom, onFit, onZoomIn, onZoomOut }: ZoomControlsProps) {
  return (
    <div className={styles.zoom} role="toolbar" aria-label="Zoom">
      <button type="button" aria-label="Adatta" title={`Adatta (${modShortcut("0")})`} onClick={onFit}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
        </svg>
      </button>
      <button type="button" aria-label="Ingrandisci" title={`Ingrandisci (${modShortcut("+")})`} onClick={onZoomIn}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M5 12h14M12 5v14" />
        </svg>
      </button>
      <button type="button" aria-label="Riduci" title={`Riduci (${modShortcut("−")})`} onClick={onZoomOut}>
        <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>
          <path d="M5 12h14" />
        </svg>
      </button>
      <span className={styles.pct}>{formatZoom(zoom)}</span>
    </div>
  );
}
