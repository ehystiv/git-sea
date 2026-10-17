import type { CiOverview, CiRun, CiRunStatus, CiWorkflow } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";
import type { GraphIndex } from "../graph/GraphIndex";
import { statusLabel } from "./labels";

/** What the graph shows for CI on one commit. */
export interface CiMarker {
  /** Latest run of each workflow on this commit, newest first. */
  runs: CiRun[];
  /** Workflows a push of one of `pushRefs` (which point here) would start. */
  push: number[];
  pushRefs: string[];
  /** A merge commit on `target`'s first-parent line: workflows a merge into it would start. */
  merge: number[];
  target: string | null;
}

/** Markers by commit id. */
export type CiMarkers = Map<string, CiMarker>;

/** The workflow a run belongs to, or null when it cannot be told. */
export function workflowOfRun(run: CiRun, workflows: CiWorkflow[]): CiWorkflow | null {
  const same = workflows.filter((w) => w.provider === run.provider && (run.path === null || w.path === run.path));
  if (same.length <= 1) return same[0] ?? null;
  return same.find((w) => w.name === run.workflow) ?? null;
}

/** Most telling outcome first: a failure is news, then whatever is still going. */
const STATUS_ORDER: CiRunStatus[] = ["Failure", "Running", "Queued", "Cancelled", "Success", "Neutral", "Skipped"];

/** The outcome to show for several runs on one commit; null for none. */
export function summaryStatus(runs: CiRun[]): CiRunStatus | null {
  let best: CiRunStatus | null = null;
  for (const run of runs) {
    if (best === null || STATUS_ORDER.indexOf(run.status) < STATUS_ORDER.indexOf(best)) best = run.status;
  }
  return best;
}

function empty(): CiMarker {
  return { runs: [], push: [], pushRefs: [], merge: [], target: null };
}

/**
 * Where CI shows on the graph: real runs on their commits, pushes on the tips of the refs that
 * would start a workflow, merges on the merge commits along each target branch's first parents.
 * `focus` keeps only one workflow. Built on the full history, so the compressed view can use it.
 */
export function buildCiMarkers(index: GraphIndex, overview: CiOverview | null, runs: CiRun[], focus: number | null): CiMarkers {
  const markers: CiMarkers = new Map();
  if (!overview) return markers;
  const keep = (ids: number[]) => (focus === null ? ids : ids.filter((id) => id === focus));
  const at = (id: string) => {
    let marker = markers.get(id);
    if (!marker) {
      marker = empty();
      markers.set(id, marker);
    }
    return marker;
  };

  // The services list runs newest first: the first one of a workflow on a commit is its latest.
  const seen = new Set<string>();
  for (const run of runs) {
    const workflow = workflowOfRun(run, overview.workflows);
    if (focus !== null && workflow?.id !== focus) continue;
    const key = `${run.commit}\n${run.provider}\n${workflow?.id ?? run.workflow}`;
    if (seen.has(key)) continue;
    seen.add(key);
    at(run.commit).runs.push(run);
  }

  for (const trigger of overview.push) {
    const workflows = keep(trigger.workflows);
    if (workflows.length === 0) continue;
    const marker = at(trigger.commit);
    for (const id of workflows) if (!marker.push.includes(id)) marker.push.push(id);
    marker.pushRefs.push(trigger.name);
  }

  // The default branch first, so a merge reachable from several targets is labelled with it.
  const targets = [...overview.mergeTargets].sort(
    (a, b) => Number(b.branch === overview.defaultBranch) - Number(a.branch === overview.defaultBranch),
  );
  const visited = new Set<number>();
  for (const target of targets) {
    const workflows = keep(target.workflows);
    if (workflows.length === 0) continue;
    let column = index.indexOf(target.commit);
    while (column !== null && !visited.has(column)) {
      visited.add(column);
      const commit = index.commits[column];
      if (!commit) break;
      if (commit.parents.length >= 2) {
        const marker = at(commit.id);
        marker.merge = workflows;
        marker.target = target.branch;
      }
      column = index.parentIndex(column);
    }
  }

  for (const [id, marker] of markers) {
    if (marker.runs.length === 0 && marker.push.length === 0 && marker.merge.length === 0) markers.delete(id);
  }
  return markers;
}

/** Which part of a marker the pointer is on: the push / run circle, or the merge one. */
export type CiSlot = "push" | "merge";

/** Text for the tooltip of a marker. */
export function describeMarker(marker: CiMarker, slot: CiSlot, workflows: CiWorkflow[], m: Messages = t()): string {
  const name = (id: number) => workflows[id]?.name ?? "?";
  if (slot === "merge") {
    return m.ci.mergeTooltip(marker.target ?? "?", marker.merge.map(name).join(", "));
  }
  const lines: string[] = [];
  for (const run of marker.runs) lines.push(`${run.workflow}: ${statusLabel(run.status, m)}`);
  if (marker.push.length > 0) {
    lines.push(m.ci.pushTooltip(marker.pushRefs.join(", "), marker.push.map(name).join(", ")));
  }
  return lines.join("\n");
}

/** The latest run of a workflow anywhere, for "go to its last run". */
export function latestRun(runs: CiRun[], workflow: CiWorkflow, workflows: CiWorkflow[]): CiRun | null {
  return runs.find((r) => workflowOfRun(r, workflows)?.id === workflow.id) ?? null;
}
