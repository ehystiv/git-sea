import type { CiProvider, PullRequest, PullRequestsReport, PullState } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";
import type { SidebarSection } from "../sidebar/sections";

/** What the graph draws on a commit for a pull or merge request. */
export interface PullBadge {
  /** `#12` on GitHub, `!12` on GitLab. */
  label: string;
  state: PullState;
}

/** Badges drawn on one commit at most; the most recently updated requests win. */
const MAX_PER_COMMIT = 2;

/** How the service writes a request's number. */
export function pullLabel(provider: CiProvider | null, number: number): string {
  return `${provider === "GitLab" ? "!" : "#"}${number}`;
}

/** The request is still open (a draft too). */
export function isOpen(pull: PullRequest): boolean {
  return pull.state === "Open" || pull.state === "Draft";
}

/**
 * The commit each request is drawn on: the newest commit of an open one, the commit that brought
 * a merged one into its target. Closed requests are left out: their commits are usually gone.
 */
export function pullBadges(report: PullRequestsReport | null | undefined): Map<string, PullBadge[]> {
  const badges = new Map<string, PullBadge[]>();
  for (const pull of report?.pulls ?? []) {
    const commit = isOpen(pull) ? pull.head : pull.state === "Merged" ? pull.mergeCommit : null;
    if (!commit) continue;
    const list = badges.get(commit) ?? [];
    if (list.length >= MAX_PER_COMMIT) continue;
    list.push({ label: pullLabel(report?.provider ?? null, pull.number), state: pull.state });
    badges.set(commit, list);
  }
  return badges;
}

/** The requests a commit is the head or the merge commit of, open ones first. */
export function pullsOfCommit(report: PullRequestsReport | null | undefined, id: string): PullRequest[] {
  return (report?.pulls ?? [])
    .filter((pull) => pull.head === id || pull.mergeCommit === id)
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));
}

/** The open requests for the sidebar, filtered like the refs; null when there are none. */
export function pullSection(report: PullRequestsReport | null | undefined, filter: string, m: Messages = t()): SidebarSection | null {
  const needle = filter.trim().toLowerCase();
  const provider = report?.provider ?? null;
  const items = (report?.pulls ?? [])
    .filter(isOpen)
    .map((pull) => {
      const label = `${pullLabel(provider, pull.number)} ${pull.title}`;
      return {
        key: `pull:${pull.number}`,
        label,
        commit: pull.head,
        title: m.pulls.itemTitle(label, pull.sourceBranch, pull.targetBranch, pull.state === "Draft"),
      };
    })
    .filter((item) => needle === "" || item.label.toLowerCase().includes(needle));
  return items.length > 0 ? { id: "pulls", title: provider === "GitLab" ? m.pulls.mergeRequests : m.pulls.pullRequests, items } : null;
}
