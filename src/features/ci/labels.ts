import type { CiProvider, CiRunStatus } from "../../lib/bindings";

export const PROVIDER_LABEL: Record<CiProvider, string> = {
  GitHub: "GitHub Actions",
  GitLab: "GitLab CI",
  CircleCi: "CircleCI",
  Azure: "Azure Pipelines",
  Bitbucket: "Bitbucket Pipelines",
  Travis: "Travis CI",
  Jenkins: "Jenkins",
};

export const STATUS_LABEL: Record<CiRunStatus, string> = {
  Queued: "in coda",
  Running: "in corso",
  Success: "riuscita",
  Failure: "fallita",
  Cancelled: "annullata",
  Skipped: "saltata",
  Neutral: "conclusa",
};

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
export const TOKEN_HINT: Record<CiProvider, string> = {
  GitHub: "Token personale con lettura di Actions (o accedi con `gh auth login`)",
  GitLab: "Token personale con scope read_api (o accedi con `glab auth login`)",
  CircleCi: "Personal API token di CircleCI",
  Azure: "Personal access token con Build (Read)",
  Bitbucket: "Access token del repository, oppure utente:app-password",
  Travis: "Token API di Travis CI",
  Jenkins: "",
};
