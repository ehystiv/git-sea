//! Pull requests (GitHub) and merge requests (GitLab) of the project the main remote points to,
//! with the commits they sit on: the head of an open one, the merge commit of a merged one.
//! Read-only, through the same tokens as the CI runs.

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use super::CiProvider;
use super::remote::RemoteRepo;
use super::runs::{
    CiAccess, HttpError, agent, bearer, encode, get_json, github_api, github_headers, str_at,
    with_token,
};

/// How many recently updated requests to ask for.
const PAGE: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum PullState {
    Open,
    Draft,
    Merged,
    /// Closed without being merged.
    Closed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    /// The number the service shows (`#12` on GitHub, `!12` on GitLab).
    pub number: u32,
    pub title: String,
    pub author: Option<String>,
    pub state: PullState,
    pub url: Option<String>,
    /// The branch the changes come from, and the one they go into.
    pub source_branch: Option<String>,
    pub target_branch: Option<String>,
    /// Full hex id of the newest commit of the request.
    pub head: Option<String>,
    /// Full hex id of the commit that brought it into the target branch, once merged (the merge
    /// commit, or the squashed or rebased commit).
    pub merge_commit: Option<String>,
    /// When it was last updated, as the service writes it (ISO 8601).
    pub updated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsReport {
    /// The service the remote is on, when it has pull or merge requests this app can read.
    pub provider: Option<CiProvider>,
    pub access: CiAccess,
    /// Newest update first.
    pub pulls: Vec<PullRequest>,
}

/// The recently updated pull or merge requests of the project `remote` points to.
pub fn fetch_pulls(remote: Option<&RemoteRepo>) -> PullRequestsReport {
    let unavailable = |provider: Option<CiProvider>, en: &str, it: &str| PullRequestsReport {
        provider,
        access: CiAccess::Unavailable {
            message: crate::i18n::tr(en, it),
        },
        pulls: Vec::new(),
    };
    let Some(remote) = remote else {
        return unavailable(
            None,
            "The repository has no remote",
            "Il repository non ha un remote",
        );
    };
    let agent = agent();
    let (provider, (access, pulls)) = if remote.is_github() {
        let provider = CiProvider::GitHub;
        (
            provider,
            with_token(provider, &remote.host, |token| {
                github(&agent, remote, token)
            }),
        )
    } else if remote.is_gitlab() {
        let provider = CiProvider::GitLab;
        (
            provider,
            with_token(provider, &remote.host, |token| {
                gitlab(&agent, remote, token)
            }),
        )
    } else {
        return unavailable(
            None,
            "Pull requests are read only from GitHub and GitLab",
            "Le pull request si leggono solo da GitHub e GitLab",
        );
    };
    PullRequestsReport {
        provider: Some(provider),
        access,
        pulls,
    }
}

fn github(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<PullRequest>, HttpError> {
    let url = format!(
        "{}/repos/{}/pulls?state=all&sort=updated&direction=desc&per_page={PAGE}",
        github_api(remote),
        remote.path
    );
    Ok(parse_github(&get_json(
        agent,
        &url,
        &github_headers(token),
    )?))
}

fn gitlab(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<PullRequest>, HttpError> {
    let url = format!(
        "https://{}/api/v4/projects/{}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page={PAGE}",
        remote.host,
        encode(&remote.path)
    );
    Ok(parse_gitlab(&get_json(agent, &url, &bearer(token))?))
}

fn number_at(value: &Value, pointer: &str) -> Option<u32> {
    value
        .pointer(pointer)?
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
}

fn is_true(value: &Value, pointer: &str) -> bool {
    value.pointer(pointer).and_then(Value::as_bool) == Some(true)
}

/// A list from `GET /repos/{owner}/{repo}/pulls`.
pub fn parse_github(body: &Value) -> Vec<PullRequest> {
    body.as_array()
        .into_iter()
        .flatten()
        .filter_map(|pr| {
            let merged = pr.pointer("/merged_at").is_some_and(|v| !v.is_null());
            let state = match str_at(pr, "/state").as_deref() {
                _ if merged => PullState::Merged,
                Some("open") if is_true(pr, "/draft") => PullState::Draft,
                Some("open") => PullState::Open,
                _ => PullState::Closed,
            };
            Some(PullRequest {
                number: number_at(pr, "/number")?,
                title: str_at(pr, "/title").unwrap_or_default(),
                author: str_at(pr, "/user/login"),
                state,
                url: str_at(pr, "/html_url"),
                source_branch: str_at(pr, "/head/ref"),
                target_branch: str_at(pr, "/base/ref"),
                head: str_at(pr, "/head/sha"),
                // For an open request this is a test merge that is in no branch.
                merge_commit: merged.then(|| str_at(pr, "/merge_commit_sha")).flatten(),
                updated: str_at(pr, "/updated_at"),
            })
        })
        .collect()
}

/// A list from `GET /projects/:id/merge_requests`.
pub fn parse_gitlab(body: &Value) -> Vec<PullRequest> {
    body.as_array()
        .into_iter()
        .flatten()
        .filter_map(|mr| {
            let draft = is_true(mr, "/draft") || is_true(mr, "/work_in_progress");
            let state = match str_at(mr, "/state").as_deref() {
                Some("merged") => PullState::Merged,
                Some("opened") if draft => PullState::Draft,
                Some("opened") => PullState::Open,
                _ => PullState::Closed,
            };
            let merge_commit = (state == PullState::Merged)
                .then(|| {
                    str_at(mr, "/merge_commit_sha").or_else(|| str_at(mr, "/squash_commit_sha"))
                })
                .flatten()
                // Fast-forward merges keep the request's own commits.
                .or_else(|| {
                    (state == PullState::Merged)
                        .then(|| str_at(mr, "/sha"))
                        .flatten()
                });
            Some(PullRequest {
                number: number_at(mr, "/iid")?,
                title: str_at(mr, "/title").unwrap_or_default(),
                author: str_at(mr, "/author/username"),
                state,
                url: str_at(mr, "/web_url"),
                source_branch: str_at(mr, "/source_branch"),
                target_branch: str_at(mr, "/target_branch"),
                head: str_at(mr, "/sha"),
                merge_commit,
                updated: str_at(mr, "/updated_at"),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_github_pull_requests() {
        let body = json!([
            { "number": 7, "title": "Open one", "state": "open", "draft": false, "merged_at": null,
              "user": { "login": "ada" }, "html_url": "https://github.com/o/r/pull/7",
              "head": { "ref": "feature", "sha": "aaa" }, "base": { "ref": "main" },
              "merge_commit_sha": "test-merge", "updated_at": "2026-10-01T10:00:00Z" },
            { "number": 6, "title": "Draft", "state": "open", "draft": true, "merged_at": null,
              "head": { "sha": "bbb" }, "merge_commit_sha": "test-merge-2" },
            { "number": 5, "title": "Merged", "state": "closed", "merged_at": "2026-09-01T00:00:00Z",
              "head": { "sha": "ccc" }, "merge_commit_sha": "ddd" },
            { "number": 4, "title": "Closed", "state": "closed", "merged_at": null, "head": { "sha": "eee" } },
            { "title": "No number" }
        ]);
        let pulls = parse_github(&body);
        let states: Vec<_> = pulls.iter().map(|p| (p.number, p.state)).collect();
        assert_eq!(
            states,
            [
                (7, PullState::Open),
                (6, PullState::Draft),
                (5, PullState::Merged),
                (4, PullState::Closed)
            ]
        );
        let open = &pulls[0];
        assert_eq!(open.author.as_deref(), Some("ada"));
        assert_eq!(open.source_branch.as_deref(), Some("feature"));
        assert_eq!(open.target_branch.as_deref(), Some("main"));
        assert_eq!(open.head.as_deref(), Some("aaa"));
        // The test merge of an open request is not a commit of the history.
        assert_eq!(open.merge_commit, None);
        assert_eq!(pulls[2].merge_commit.as_deref(), Some("ddd"));
    }

    #[test]
    fn reads_gitlab_merge_requests() {
        let body = json!([
            { "iid": 3, "title": "Draft: wip", "state": "opened", "draft": true, "sha": "aaa",
              "source_branch": "wip", "target_branch": "main", "author": { "username": "bob" } },
            { "iid": 2, "title": "Merged", "state": "merged", "sha": "bbb", "merge_commit_sha": "ccc" },
            { "iid": 1, "title": "Squashed", "state": "merged", "sha": "ddd", "merge_commit_sha": null,
              "squash_commit_sha": "eee" },
            { "iid": 0, "title": "Fast-forward", "state": "merged", "sha": "fff", "merge_commit_sha": null },
            { "iid": 9, "title": "Gone", "state": "closed", "sha": "ggg" }
        ]);
        let pulls = parse_gitlab(&body);
        let summary: Vec<_> = pulls
            .iter()
            .map(|p| (p.number, p.state, p.merge_commit.as_deref()))
            .collect();
        assert_eq!(
            summary,
            [
                (3, PullState::Draft, None),
                (2, PullState::Merged, Some("ccc")),
                (1, PullState::Merged, Some("eee")),
                (0, PullState::Merged, Some("fff")),
                (9, PullState::Closed, None)
            ]
        );
        assert_eq!(pulls[0].author.as_deref(), Some("bob"));
        assert_eq!(pulls[0].source_branch.as_deref(), Some("wip"));
    }
}
