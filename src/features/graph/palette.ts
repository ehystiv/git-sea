import { BRANCH_COLORS } from "./constants";

/** Canvas colours, read from the CSS tokens so the graph follows the system theme. */
export interface Palette {
  canvas: string;
  dot: string;
  node: string;
  text: string;
  text2: string;
  text3: string;
  accent: string;
  accentText: string;
  accentContrast: string;
  /** Outcomes of CI runs, and the symbols drawn on them. */
  success: string;
  failure: string;
  pending: string;
  onStatus: string;
  branch: string[];
  fontUi: string;
  fontMono: string;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    canvas: get("--canvas"),
    dot: get("--dot"),
    node: get("--node"),
    text: get("--text"),
    text2: get("--text-2"),
    text3: get("--text-3"),
    accent: get("--accent"),
    accentText: get("--accent-text"),
    accentContrast: get("--accent-contrast"),
    success: get("--add"),
    failure: get("--danger"),
    pending: get("--b2"),
    onStatus: get("--node"),
    branch: Array.from({ length: BRANCH_COLORS }, (_, i) => get(`--b${i}`)),
    fontUi: get("--font-ui"),
    fontMono: get("--font-mono"),
  };
}
