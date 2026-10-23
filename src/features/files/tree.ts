import type { EntryKind, TreeFile } from "../../lib/bindings";

/** A directory or a file of a commit's tree. */
export interface TreeNode {
  /** Last part of the path; empty for the root. */
  name: string;
  /** Full path from the root; empty for the root. */
  path: string;
  kind: EntryKind | "Dir";
  /** Directories only: directories first, then files, each by name. */
  children: TreeNode[];
}

/** The tree of directories and files of a sorted (or unsorted) list of paths. */
export function buildTree(files: readonly TreeFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "Dir", children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  const dirOf = (path: string): TreeNode => {
    const known = dirs.get(path);
    if (known) return known;
    const cut = path.lastIndexOf("/");
    const parent = dirOf(cut < 0 ? "" : path.slice(0, cut));
    const node: TreeNode = { name: path.slice(cut + 1), path, kind: "Dir", children: [] };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const file of files) {
    const cut = file.path.lastIndexOf("/");
    dirOf(cut < 0 ? "" : file.path.slice(0, cut)).children.push({ name: file.path.slice(cut + 1), path: file.path, kind: file.kind, children: [] });
  }
  for (const dir of dirs.values()) dir.children.sort(byKindThenName);
  return root;
}

function byKindThenName(a: TreeNode, b: TreeNode): number {
  const dirA = a.kind === "Dir";
  const dirB = b.kind === "Dir";
  if (dirA !== dirB) return dirA ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  /** Directories only. */
  open: boolean;
}

/** The rows shown for `root` with the directories in `expanded` open, in display order. */
export function treeRows(root: TreeNode, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      const open = child.kind === "Dir" && expanded.has(child.path);
      rows.push({ node: child, depth, open });
      if (open) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

/** The directories holding `path`, outermost first: what must be open to show it. */
export function parentDirs(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export interface FileMatch {
  file: TreeFile;
  score: number;
  /** Positions in the path of the characters that matched, ascending. */
  marks: number[];
}

const SEPARATORS = "/._- ";

/**
 * Whether the characters of `query` appear in order in `path` (ignoring case), as in an editor's
 * "go to file", and how well: runs of consecutive characters, characters at the start of a word
 * and a match inside the file name score higher; long paths score a little lower. Spaces in the
 * query are ignored.
 */
export function fuzzyMatch(query: string, path: string): { score: number; marks: number[] } | null {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (needle === "") return { score: 0, marks: [] };
  const haystack = path.toLowerCase();
  const nameStart = path.lastIndexOf("/") + 1;

  // The match ending latest in the path, found from the end, keeps it in the file name when it can.
  const marks: number[] = new Array<number>(needle.length);
  let at = haystack.length - 1;
  for (let i = needle.length - 1; i >= 0; i--) {
    while (at >= 0 && haystack[at] !== needle[i]) at--;
    if (at < 0) return null;
    marks[i] = at--;
  }
  // Then, from where that match starts, each character is taken as early as it can be, which
  // closes the gaps: "dif" in "diff" is d-i-f, not d-i-_-f.
  for (let i = 1; i < needle.length; i++) {
    let j = (marks[i - 1] ?? 0) + 1;
    while (haystack[j] !== needle[i]) j++;
    marks[i] = j;
  }

  let score = 0;
  for (let i = 0; i < marks.length; i++) {
    const position = marks[i] ?? 0;
    score += 1;
    if (i > 0 && marks[i - 1] === position - 1) score += 4;
    const before = position === 0 ? "/" : (path[position - 1] ?? "/");
    if (SEPARATORS.includes(before)) score += 3;
    else if (before === before.toLowerCase() && path[position] !== path[position]?.toLowerCase()) score += 2;
    if (position >= nameStart) score += 2;
  }
  if (haystack.slice(nameStart).startsWith(needle)) score += 6;
  score -= path.length / 100;
  return { score, marks };
}

/** The files matching `query`, best first (then by path), at most `limit`. */
export function filterFiles(files: readonly TreeFile[], query: string, limit: number): FileMatch[] {
  const found: FileMatch[] = [];
  for (const file of files) {
    const match = fuzzyMatch(query, file.path);
    if (match) found.push({ file, ...match });
  }
  found.sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1));
  return found.slice(0, limit);
}

/** Pieces of `text` in order, each marked or not, for highlighting the matched characters. */
export function markedPieces(text: string, marks: readonly number[]): Array<{ text: string; marked: boolean }> {
  const set = new Set(marks);
  const pieces: Array<{ text: string; marked: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const marked = set.has(i);
    const last = pieces[pieces.length - 1];
    if (last && last.marked === marked) last.text += text[i];
    else pieces.push({ text: text[i] ?? "", marked });
  }
  return pieces;
}
