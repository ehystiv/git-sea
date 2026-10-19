import { describe, expect, it } from "vitest";
import type { PullRequest, PullRequestsReport } from "../../lib/bindings";
import { t } from "../../lib/i18n";
import { pullBadges, pullSection, pullsOfCommit } from "./pulls";

function pull(number: number, state: PullRequest["state"], head: string | null, mergeCommit: string | null = null, title = `pr ${number}`): PullRequest {
  return { number, title, author: null, state, url: null, sourceBranch: "feature", targetBranch: "main", head, mergeCommit, updated: null };
}

const report = (pulls: PullRequest[], provider: PullRequestsReport["provider"] = "GitHub"): PullRequestsReport => ({
  provider,
  access: { kind: "ok", via: "Anonymous", runs: pulls.length },
  pulls,
});

describe("pullBadges", () => {
  it("puts open requests on their head and merged ones on their merge commit", () => {
    const badges = pullBadges(report([pull(3, "Open", "a"), pull(2, "Draft", "b"), pull(1, "Merged", "c", "m"), pull(0, "Closed", "d")]));
    expect(Object.fromEntries(badges)).toEqual({
      a: [{ label: "#3", state: "Open" }],
      b: [{ label: "#2", state: "Draft" }],
      m: [{ label: "#1", state: "Merged" }],
    });
  });

  it("writes GitLab numbers with ! and keeps at most two per commit", () => {
    const badges = pullBadges(report([pull(3, "Open", "a"), pull(2, "Open", "a"), pull(1, "Open", "a")], "GitLab"));
    expect(badges.get("a")?.map((b) => b.label)).toEqual(["!3", "!2"]);
    expect(pullBadges(null).size).toBe(0);
  });
});

describe("pullsOfCommit", () => {
  it("finds the requests a commit is the head or the merge commit of, open first", () => {
    const data = report([pull(2, "Merged", "x", "a"), pull(1, "Open", "a"), pull(0, "Open", "b")]);
    expect(pullsOfCommit(data, "a").map((p) => p.number)).toEqual([1, 2]);
    expect(pullsOfCommit(data, "z")).toEqual([]);
  });
});

describe("pullSection", () => {
  it("lists the open requests, filtered by number or title", () => {
    const data = report([pull(2, "Open", "a", null, "Add login"), pull(1, "Merged", "b"), pull(0, "Draft", "c", null, "Fix logout")]);
    expect(pullSection(data, "", t())?.items.map((i) => i.label)).toEqual(["#2 Add login", "#0 Fix logout"]);
    expect(pullSection(data, "logout", t())?.items.map((i) => i.commit)).toEqual(["c"]);
    expect(pullSection(data, "nothing", t())).toBeNull();
  });
});
