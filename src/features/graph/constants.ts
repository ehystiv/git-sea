/** World units: column `i` (0 = newest commit) sits at x = -i * COLUMN_W, lane `l` at y = l * LANE_H. */
export const COLUMN_W = 156;
export const LANE_H = 92;
export const NODE = 60;
export const HALF = NODE / 2;

export const MIN_ZOOM = 0.004;
export const MAX_ZOOM = 2;

/** Below this zoom nodes are tiles without text; above, full cards. */
export const LOD_CARD = 0.6;
/** Below this zoom nodes are plain squares and some columns are skipped. */
export const LOD_TILE = 0.2;
/** Columns narrower than this many pixels are drawn sampled. */
export const MIN_COLUMN_PX = 1.5;

export const BRANCH_COLORS = 8;
