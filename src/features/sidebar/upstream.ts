import { useQuery } from "@tanstack/react-query";
import { commands, type RefLabel, type Upstream } from "../../lib/bindings";
import { CommandError } from "../../lib/errors";
import type { GraphIndex } from "../graph/GraphIndex";
import { divergence } from "../graph/range";

/** The upstream of each local branch, from the repository configuration. */
export function useUpstreams(sessionId: string) {
  return useQuery<Upstream[], CommandError>({
    queryKey: ["upstreams", sessionId],
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const result = await commands.listUpstreams(sessionId);
      if (result.status === "error") throw new CommandError(result.error);
      return result.data;
    },
  });
}

export interface BranchDivergence {
  branch: string;
  upstream: string;
  /** The commits the two point at. */
  branchCommit: string;
  upstreamCommit: string;
  /** Commits on the local branch that its upstream does not have. */
  ahead: number;
  /** Commits on the upstream that the local branch does not have. */
  behind: number;
}

/**
 * How far each local branch is from its upstream, keyed by branch name. Branches whose upstream
 * does not exist locally, or is not loaded (the branch filter hides it), are left out.
 */
export function branchDivergences(index: GraphIndex, upstreams: readonly Upstream[]): Map<string, BranchDivergence> {
  const local = new Map<string, RefLabel>();
  const remote = new Map<string, RefLabel>();
  for (const labels of index.refs.values()) {
    for (const label of labels) {
      if (label.kind === "Branch" || label.kind === "Head") local.set(label.name, label);
      else if (label.kind === "Remote") remote.set(label.name, label);
    }
  }
  const out = new Map<string, BranchDivergence>();
  for (const { branch, upstream } of upstreams) {
    const branchCommit = local.get(branch)?.commit;
    const upstreamCommit = remote.get(upstream)?.commit;
    if (branchCommit === undefined || upstreamCommit === undefined) continue;
    const a = index.indexOf(branchCommit);
    const b = index.indexOf(upstreamCommit);
    if (a === null || b === null) continue;
    const { ahead, behind } = divergence(index, a, b);
    out.set(branch, { branch, upstream, branchCommit, upstreamCommit, ahead, behind });
  }
  return out;
}
