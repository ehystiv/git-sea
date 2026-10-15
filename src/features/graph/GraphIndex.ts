import type { CommitSummary, GraphRow, RefLabel } from "../../lib/bindings";

/** Called around `replaceWith`, so a view can keep its place while the data underneath changes. */
export interface ReplaceListener {
  before: () => void;
  after: () => void;
}

/**
 * Everything the graph view needs about the loaded history, in arrays and maps that are appended
 * to as chunks arrive. It is mutable on purpose: copying 50k-element arrays on every chunk would
 * waste time, and the renderer reads it directly. Row `i` of `rows` belongs to `commits[i]`.
 */
export class GraphIndex {
  commits: CommitSummary[] = [];
  rows: GraphRow[] = [];
  refs = new Map<string, RefLabel[]>();
  /** Highest lane index used anywhere so far. */
  maxLane = 0;

  private idToIndex = new Map<string, number>();
  private childrenOf = new Map<string, number[]>();
  private replaceListeners: ReplaceListener[] = [];

  reset(): void {
    this.commits = [];
    this.rows = [];
    this.refs = new Map();
    this.maxLane = 0;
    this.idToIndex = new Map();
    this.childrenOf = new Map();
  }

  /** Registers a listener; the returned function removes it. */
  onReplace(listener: ReplaceListener): () => void {
    this.replaceListeners.push(listener);
    return () => {
      this.replaceListeners = this.replaceListeners.filter((l) => l !== listener);
    };
  }

  /** Takes over everything `other` holds (which must not be used afterwards). */
  replaceWith(other: GraphIndex): void {
    this.replaceListeners.forEach((l) => l.before());
    this.commits = other.commits;
    this.rows = other.rows;
    this.refs = other.refs;
    this.maxLane = other.maxLane;
    this.idToIndex = other.idToIndex;
    this.childrenOf = other.childrenOf;
    this.replaceListeners.forEach((l) => l.after());
  }

  appendChunk(commits: CommitSummary[], rows: GraphRow[]): void {
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const row = rows[i];
      if (!commit || !row) continue;
      const index = this.commits.length;
      this.commits.push(commit);
      this.rows.push(row);
      this.idToIndex.set(commit.id, index);
      for (const parent of commit.parents) {
        const children = this.childrenOf.get(parent);
        if (children) children.push(index);
        else this.childrenOf.set(parent, [index]);
      }
      this.maxLane = Math.max(this.maxLane, row.lane);
      for (const edge of row.edges) {
        this.maxLane = Math.max(this.maxLane, edge.fromLane, edge.toLane);
      }
    }
  }

  setRefs(labels: RefLabel[]): void {
    this.refs = new Map();
    for (const label of labels) {
      const list = this.refs.get(label.commit);
      if (list) list.push(label);
      else this.refs.set(label.commit, [label]);
    }
  }

  get length(): number {
    return this.commits.length;
  }

  /** Position of a commit in the walk, or null when it is not loaded. */
  indexOf(id: string): number | null {
    return this.idToIndex.get(id) ?? null;
  }

  /** Index of the first parent, or null when it is a root or not loaded yet. */
  parentIndex(index: number): number | null {
    const parent = this.commits[index]?.parents[0];
    return parent === undefined ? null : (this.idToIndex.get(parent) ?? null);
  }

  /** Index of the nearest child on the same lane when possible, else the nearest child. */
  childIndex(index: number): number | null {
    const commit = this.commits[index];
    const row = this.rows[index];
    if (!commit || !row) return null;
    const children = this.childrenOf.get(commit.id);
    if (!children || children.length === 0) return null;
    // Children are stored oldest-last; the nearest one (largest index) is the next to the right.
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child !== undefined && this.rows[child]?.lane === row.lane) return child;
    }
    return children[children.length - 1] ?? null;
  }
}
