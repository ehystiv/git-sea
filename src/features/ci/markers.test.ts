import { describe, expect, it } from "vitest";
import type { CiOverview, CiRun, CiWorkflow } from "../../lib/bindings";
import { fakeIndex } from "../graph/testData";
import { buildCiMarkers, describeMarker, summaryStatus, workflowOfRun } from "./markers";

function workflow(id: number, name: string, path: string, provider: CiWorkflow["provider"] = "GitHub"): CiWorkflow {
  return { id, provider, name, path, events: ["push"], approximate: false, webUrl: null };
}

function run(commit: string, status: CiRun["status"], path: string | null = ".github/workflows/ci.yml", name = "CI"): CiRun {
  return { provider: "GitHub", workflow: name, path, commit, branch: "main", event: "push", status, url: null, created: null };
}

// main: m3 (merge of f1) -> m2 -> m1 (merge of g1) -> m0; feature: f1 -> m0
const index = fakeIndex([
  { id: "m3", parents: ["m2", "f1"] },
  { id: "f1", parents: ["m0"] },
  { id: "m2", parents: ["m1"] },
  { id: "m1", parents: ["m0", "g1"] },
  { id: "g1", parents: ["m0"] },
  { id: "m0" },
]);

const workflows = [workflow(0, "CI", ".github/workflows/ci.yml"), workflow(1, "Release", ".github/workflows/release.yml")];

const overview: CiOverview = {
  workflows,
  push: [
    { kind: "Head", name: "main", branch: "main", commit: "m3", workflows: [0] },
    { kind: "Remote", name: "origin/main", branch: "main", commit: "m3", workflows: [0, 1] },
  ],
  mergeTargets: [
    { kind: "Branch", name: "feature", branch: "feature", commit: "f1", workflows: [1] },
    { kind: "Head", name: "main", branch: "main", commit: "m3", workflows: [0] },
  ],
  problems: [],
  defaultBranch: "main",
};

describe("buildCiMarkers", () => {
  it("puts pushes on the tips and merges on the target's first-parent line", () => {
    const markers = buildCiMarkers(index, overview, [], null);
    expect(markers.get("m3")?.push).toEqual([0, 1]);
    expect(markers.get("m3")?.pushRefs).toEqual(["main", "origin/main"]);
    expect(markers.get("m3")?.merge).toEqual([0]);
    expect(markers.get("m3")?.target).toBe("main");
    expect(markers.get("m1")?.merge).toEqual([0]);
    // f1 is no merge, g1 is off main's first parents.
    expect(markers.has("f1")).toBe(false);
    expect(markers.has("g1")).toBe(false);
  });

  it("keeps the latest run of each workflow per commit", () => {
    const runs = [run("m2", "Running"), run("m2", "Failure"), run("m2", "Success", ".github/workflows/release.yml", "Release")];
    const marker = buildCiMarkers(index, overview, runs, null).get("m2");
    expect(marker?.runs.map((r) => r.status)).toEqual(["Running", "Success"]);
    expect(summaryStatus(marker?.runs ?? [])).toBe("Running");
  });

  it("shows only the focused workflow", () => {
    const runs = [run("m2", "Success"), run("m0", "Failure", ".github/workflows/release.yml", "Release")];
    const markers = buildCiMarkers(index, overview, runs, 1);
    expect(markers.get("m3")?.push).toEqual([1]);
    expect(markers.get("m3")?.merge ?? []).toEqual([]);
    expect(markers.has("m2")).toBe(false);
    expect(markers.get("m0")?.runs).toHaveLength(1);
  });

  it("describes a marker for its tooltip", () => {
    const marker = buildCiMarkers(index, overview, [run("m3", "Failure")], null).get("m3");
    if (!marker) throw new Error("no marker");
    expect(describeMarker(marker, "push", workflows)).toBe("CI: fallita\nUn push di main, origin/main avvierebbe: CI, Release");
    expect(describeMarker(marker, "merge", workflows)).toBe("Un merge in main avvierebbe: CI");
  });
});

describe("workflowOfRun", () => {
  it("matches by file, then by name when one file holds several workflows", () => {
    const circle = [workflow(0, "build", ".circleci/config.yml", "CircleCi"), workflow(1, "deploy", ".circleci/config.yml", "CircleCi")];
    const r: CiRun = { ...run("x", "Success", ".circleci/config.yml", "deploy"), provider: "CircleCi" };
    expect(workflowOfRun(r, circle)?.id).toBe(1);
    expect(workflowOfRun(run("x", "Success"), workflows)?.id).toBe(0);
    expect(workflowOfRun({ ...run("x", "Success", null), provider: "Azure" }, workflows)).toBeNull();
  });

  it("summarises failures first", () => {
    expect(summaryStatus([run("a", "Success"), run("a", "Failure")])).toBe("Failure");
    expect(summaryStatus([])).toBeNull();
  });
});
