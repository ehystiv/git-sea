import type { CommitKind } from "./describe";

/** 24×24 outline icons (Lucide style), as SVG path data so they can be drawn with Path2D. */
const ICON_PATHS: Record<CommitKind, string> = {
  merge: "M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M6 21V9a9 9 0 0 0 9 9",
  feat: "M12 3l1.9 5.8L20 10.5l-6.1 1.7L12 18l-1.9-5.8L4 10.5l6.1-1.7z",
  fix: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  refactor:
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16 M8 16H3v5",
  docs: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 13h4 M10 17h4",
  chore: "M12 2 3 7v10l9 5 9-5V7z M3 7l9 5 9-5 M12 12v10",
  perf: "M13 2 3 14h9l-1 8 10-12h-9z",
  init: "M4 22V4 M4 4h13l-2 4 2 4H4",
  commit: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M3 12h6 M15 12h6",
};

const cache = new Map<CommitKind, Path2D>();

export function iconPath(kind: CommitKind): Path2D {
  let path = cache.get(kind);
  if (!path) {
    path = new Path2D(ICON_PATHS[kind]);
    cache.set(kind, path);
  }
  return path;
}
