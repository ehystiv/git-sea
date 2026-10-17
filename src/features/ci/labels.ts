import type { CiProvider, CiRunStatus } from "../../lib/bindings";
import { t, type Messages } from "../../lib/i18n";

export const PROVIDER_LABEL: Record<CiProvider, string> = {
  GitHub: "GitHub Actions",
  GitLab: "GitLab CI",
  CircleCi: "CircleCI",
  Azure: "Azure Pipelines",
  Bitbucket: "Bitbucket Pipelines",
  Travis: "Travis CI",
  Jenkins: "Jenkins",
};

/** A run's outcome in words, in the UI language. */
export function statusLabel(status: CiRunStatus, m: Messages = t()): string {
  return m.ci.status[status];
}

/** CSS colour of a run's outcome. */
export function statusColor(status: CiRunStatus | null): string {
  switch (status) {
    case "Success":
      return "var(--add)";
    case "Failure":
      return "var(--danger)";
    case "Running":
    case "Queued":
      return "var(--b2)";
    default:
      return "var(--text-3)";
  }
}

/** What to paste into the token field, per service. */
export function tokenHint(provider: CiProvider, m: Messages = t()): string {
  return m.ci.tokenHint[provider];
}
