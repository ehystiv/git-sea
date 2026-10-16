import type { CommitSummary, Edge, GraphRow } from "../../lib/bindings";
import { GraphIndex } from "./GraphIndex";

export interface FakeCommit {
  id: string;
  parents?: string[];
  lane?: number;
  summary?: string;
  author?: string;
  /** Unix seconds; defaults to 0. */
  time?: number | null;
}

/** An index built from newest-first fake commits; every row has the given lane and no edges. */
export function fakeIndex(commits: FakeCommit[]): GraphIndex {
  const index = new GraphIndex();
  const summaries: CommitSummary[] = commits.map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    author: c.author ?? "Test",
    time: c.time === undefined ? 0 : c.time,
    parents: c.parents ?? [],
  }));
  const rows: GraphRow[] = commits.map((c) => ({ lane: c.lane ?? 0, color: 0, edges: [] }));
  index.appendChunk(summaries, rows);
  return index;
}

/**
 * An index whose rows come from the same lane rules as the backend (`src-tauri/src/graph/lanes.rs`),
 * minus colours: for tests that need real edges. Commits are newest first, as the walk sends them.
 */
export function laidOutIndex(commits: FakeCommit[]): GraphIndex {
  const lanes: Array<string | null> = [];
  const free = () => {
    const at = lanes.indexOf(null);
    if (at >= 0) return at;
    lanes.push(null);
    return lanes.length - 1;
  };
  const edge = (fromLane: number, toLane: number, kind: Edge["kind"]): Edge => ({ fromLane, toLane, kind, color: 0 });
  const rows: GraphRow[] = commits.map(({ id, parents = [] }) => {
    const incoming = lanes.flatMap((expects, i) => (expects === id ? [i] : []));
    const node = incoming[0] ?? free();
    lanes[node] = id;
    const edges: Edge[] = [];
    lanes.forEach((expects, i) => {
      if (expects === null) return;
      if (i === node) {
        if (incoming.length > 0) edges.push(edge(node, node, "In"));
      } else if (expects === id) edges.push(edge(i, node, "MergeIn"));
      else edges.push(edge(i, i, "Through"));
    });
    for (const lane of incoming.slice(1)) lanes[lane] = null;
    const [first, ...rest] = parents;
    if (first === undefined) lanes[node] = null;
    else {
      lanes[node] = first;
      edges.push(edge(node, node, "Out"));
      rest.forEach((parent, n) => {
        if (parent === first || rest.slice(0, n).includes(parent)) return;
        let lane = lanes.indexOf(parent);
        if (lane < 0) {
          lane = free();
          lanes[lane] = parent;
        }
        edges.push(edge(node, lane, "ForkOut"));
      });
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    return { lane: node, color: 0, edges };
  });
  const index = new GraphIndex();
  index.appendChunk(fakeIndex(commits).commits, rows);
  return index;
}
