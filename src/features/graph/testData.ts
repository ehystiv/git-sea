import type { CommitSummary, GraphRow } from "../../lib/bindings";
import { GraphIndex } from "./GraphIndex";

export interface FakeCommit {
  id: string;
  parents?: string[];
  lane?: number;
  summary?: string;
}

/** An index built from newest-first fake commits; every row has the given lane and no edges. */
export function fakeIndex(commits: FakeCommit[]): GraphIndex {
  const index = new GraphIndex();
  const summaries: CommitSummary[] = commits.map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    author: "Test",
    time: 0,
    parents: c.parents ?? [],
  }));
  const rows: GraphRow[] = commits.map((c) => ({ lane: c.lane ?? 0, color: 0, edges: [] }));
  index.appendChunk(summaries, rows);
  return index;
}
