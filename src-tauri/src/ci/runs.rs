//! Recent runs from the CI services' APIs, with their commit and outcome. Read-only: nothing is
//! ever started, re-run or cancelled.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use super::CiProvider;
use super::auth::{self, CiAuthSource};
use super::remote::RemoteRepo;

/// How many recent runs to ask each service for.
const PAGE: u32 = 100;
/// CircleCI needs one more request per pipeline to know its workflows.
const CIRCLE_PIPELINES: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum CiRunStatus {
    Queued,
    Running,
    Success,
    Failure,
    Cancelled,
    Skipped,
    /// Finished without a pass or a fail (manual, neutral, partially succeeded…).
    Neutral,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiRun {
    pub provider: CiProvider,
    /// Workflow (or pipeline) name, as the service shows it.
    pub workflow: String,
    /// File of the workflow, when the service says it.
    pub path: Option<String>,
    /// Full hex id of the commit it ran on.
    pub commit: String,
    pub branch: Option<String>,
    pub event: Option<String>,
    pub status: CiRunStatus,
    pub url: Option<String>,
    /// When it was created, as the service writes it (ISO 8601).
    pub created: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CiAccess {
    #[serde(rename_all = "camelCase")]
    Ok { via: CiAuthSource, runs: u32 },
    /// The project is not readable without a (valid) token.
    #[serde(rename_all = "camelCase")]
    NeedsToken { message: String },
    /// Runs cannot be read for this repository at all.
    #[serde(rename_all = "camelCase")]
    Unavailable { message: String },
    #[serde(rename_all = "camelCase")]
    Failed { message: String },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiProviderState {
    pub provider: CiProvider,
    pub access: CiAccess,
    /// A token for it is saved in the Keychain.
    pub has_saved_token: bool,
    /// The provider's command line tool is installed (`gh`, `glab`).
    pub has_cli: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiRunsReport {
    pub runs: Vec<CiRun>,
    pub providers: Vec<CiProviderState>,
}

/// Recent runs of every provider in `providers`, for the project `remote` points to.
pub fn fetch_runs(providers: &[CiProvider], remote: Option<&RemoteRepo>) -> CiRunsReport {
    let mut seen = Vec::new();
    let mut report = CiRunsReport {
        runs: Vec::new(),
        providers: Vec::new(),
    };
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
        .http_status_as_error(false)
        .build()
        .into();
    for &provider in providers {
        if seen.contains(&provider) {
            continue;
        }
        seen.push(provider);
        let (access, runs) = match remote {
            None => (
                CiAccess::Unavailable {
                    message: "Il repository non ha un remote".to_owned(),
                },
                Vec::new(),
            ),
            Some(remote) => provider_runs(&agent, provider, remote),
        };
        report.runs.extend(runs);
        report.providers.push(CiProviderState {
            provider,
            access,
            has_saved_token: auth::keychain_get(provider).is_some(),
            has_cli: auth::has_cli(provider),
        });
    }
    report
}

fn unavailable(message: &str) -> (CiAccess, Vec<CiRun>) {
    (
        CiAccess::Unavailable {
            message: message.to_owned(),
        },
        Vec::new(),
    )
}

fn provider_runs(
    agent: &ureq::Agent,
    provider: CiProvider,
    remote: &RemoteRepo,
) -> (CiAccess, Vec<CiRun>) {
    match provider {
        CiProvider::GitHub if remote.is_github() => {
            with_token(provider, &remote.host, |token| github(agent, remote, token))
        }
        CiProvider::GitHub => unavailable("Il remote non è su GitHub"),
        CiProvider::GitLab if remote.is_gitlab() => {
            with_token(provider, &remote.host, |token| gitlab(agent, remote, token))
        }
        CiProvider::GitLab => unavailable("Il remote non è su un server GitLab riconoscibile"),
        CiProvider::CircleCi if remote.is_github() || remote.is_bitbucket() => {
            with_token(provider, &remote.host, |token| {
                circleci(agent, remote, token)
            })
        }
        CiProvider::CircleCi => unavailable("CircleCI legge solo progetti su GitHub o Bitbucket"),
        CiProvider::Azure => match remote.azure() {
            Some(project) => with_token(provider, &remote.host, |token| {
                azure(agent, &project, token)
            }),
            None => unavailable(
                "Il remote non è su Azure Repos: organizzazione e progetto non si possono dedurre",
            ),
        },
        CiProvider::Bitbucket if remote.is_bitbucket() => {
            with_token(provider, &remote.host, |token| {
                bitbucket(agent, remote, token)
            })
        }
        CiProvider::Bitbucket => unavailable("Il remote non è su Bitbucket"),
        CiProvider::Travis if remote.is_github() => {
            with_token(provider, &remote.host, |token| travis(agent, remote, token))
        }
        CiProvider::Travis => unavailable("Travis CI legge solo progetti su GitHub"),
        CiProvider::Jenkins => unavailable("Il server Jenkins non si può dedurre dal repository"),
    }
}

/// Calls the service with the best token there is, or without one (public projects).
fn with_token(
    provider: CiProvider,
    host: &str,
    call: impl Fn(Option<&str>) -> Result<Vec<CiRun>, HttpError>,
) -> (CiAccess, Vec<CiRun>) {
    let token = auth::token(provider, host);
    let via = token
        .as_ref()
        .map_or(CiAuthSource::Anonymous, |(_, via)| *via);
    match call(token.as_ref().map(|(t, _)| t.as_str())) {
        Ok(runs) => (
            CiAccess::Ok {
                via,
                runs: u32::try_from(runs.len()).unwrap_or(u32::MAX),
            },
            runs,
        ),
        // Private projects answer "not found" to whoever cannot see them.
        Err(HttpError::Unauthorized | HttpError::NotFound) => {
            let message = if token.is_some() {
                "Il token non è valido o non può leggere questo progetto"
            } else {
                "Serve un token per leggere le run di questo progetto"
            };
            (
                CiAccess::NeedsToken {
                    message: message.to_owned(),
                },
                Vec::new(),
            )
        }
        Err(HttpError::Other(message)) => (CiAccess::Failed { message }, Vec::new()),
    }
}

// ---- HTTP ------------------------------------------------------------------------------------

#[derive(Debug)]
enum HttpError {
    Unauthorized,
    NotFound,
    Other(String),
}

fn get_json(
    agent: &ureq::Agent,
    url: &str,
    headers: &[(&str, String)],
) -> Result<Value, HttpError> {
    let mut request = agent
        .get(url)
        .header("User-Agent", "git-sea")
        .header("Accept", "application/json");
    for (name, value) in headers {
        request = request.header(*name, value.as_str());
    }
    let mut response = request
        .call()
        .map_err(|e| HttpError::Other(e.to_string()))?;
    match response.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(HttpError::Unauthorized),
        404 => return Err(HttpError::NotFound),
        status => return Err(HttpError::Other(format!("HTTP {status}"))),
    }
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|e| HttpError::Other(e.to_string()))?;
    serde_json::from_str(&text).map_err(|e| HttpError::Other(e.to_string()))
}

fn str_at(value: &Value, pointer: &str) -> Option<String> {
    match value.pointer(pointer)? {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn bearer(token: Option<&str>) -> Vec<(&'static str, String)> {
    token
        .map(|t| vec![("Authorization", format!("Bearer {t}"))])
        .unwrap_or_default()
}

/// Encodes a path segment for a URL (`group/repo` → `group%2Frepo`).
fn encode(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// ---- services --------------------------------------------------------------------------------

fn github(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let api = if remote.host == "github.com" {
        "https://api.github.com".to_owned()
    } else {
        format!("https://{}/api/v3", remote.host)
    };
    let url = format!("{api}/repos/{}/actions/runs?per_page={PAGE}", remote.path);
    let mut headers = bearer(token);
    headers.push(("Accept", "application/vnd.github+json".to_owned()));
    headers.push(("X-GitHub-Api-Version", "2022-11-28".to_owned()));
    let body = get_json(agent, &url, &headers)?;
    let runs = body
        .get("workflow_runs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten();
    Ok(runs
        .filter_map(|run| {
            let status = match (
                str_at(run, "/status").as_deref(),
                str_at(run, "/conclusion").as_deref(),
            ) {
                (Some("completed"), Some("success")) => CiRunStatus::Success,
                (Some("completed"), Some("failure" | "timed_out" | "startup_failure")) => {
                    CiRunStatus::Failure
                }
                (Some("completed"), Some("cancelled")) => CiRunStatus::Cancelled,
                (Some("completed"), Some("skipped")) => CiRunStatus::Skipped,
                (Some("completed"), _) => CiRunStatus::Neutral,
                (Some("in_progress"), _) => CiRunStatus::Running,
                _ => CiRunStatus::Queued,
            };
            Some(CiRun {
                provider: CiProvider::GitHub,
                workflow: str_at(run, "/name").unwrap_or_else(|| "workflow".to_owned()),
                // Reusable workflows report `path@ref`.
                path: str_at(run, "/path").map(|p| p.split('@').next().unwrap_or(&p).to_owned()),
                commit: str_at(run, "/head_sha")?,
                branch: str_at(run, "/head_branch"),
                event: str_at(run, "/event"),
                status,
                url: str_at(run, "/html_url"),
                created: str_at(run, "/created_at"),
            })
        })
        .collect())
}

fn gitlab(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let url = format!(
        "https://{}/api/v4/projects/{}/pipelines?per_page={PAGE}",
        remote.host,
        encode(&remote.path)
    );
    let body = get_json(agent, &url, &bearer(token))?;
    Ok(body
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let status = match str_at(p, "/status").as_deref() {
                Some("success") => CiRunStatus::Success,
                Some("failed") => CiRunStatus::Failure,
                Some("running") => CiRunStatus::Running,
                Some("canceled" | "canceling") => CiRunStatus::Cancelled,
                Some("skipped") => CiRunStatus::Skipped,
                Some("manual") => CiRunStatus::Neutral,
                _ => CiRunStatus::Queued,
            };
            Some(CiRun {
                provider: CiProvider::GitLab,
                workflow: str_at(p, "/name").unwrap_or_else(|| "GitLab CI".to_owned()),
                path: Some(".gitlab-ci.yml".to_owned()),
                commit: str_at(p, "/sha")?,
                branch: str_at(p, "/ref"),
                event: str_at(p, "/source"),
                status,
                url: str_at(p, "/web_url"),
                created: str_at(p, "/created_at"),
            })
        })
        .collect())
}

fn circleci(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let (short, vcs) = if remote.is_github() {
        ("gh", "github")
    } else {
        ("bb", "bitbucket")
    };
    let headers: Vec<(&str, String)> = token
        .map(|t| vec![("Circle-Token", t.to_owned())])
        .unwrap_or_default();
    let url = format!(
        "https://circleci.com/api/v2/project/{short}/{}/pipeline",
        remote.path
    );
    let body = get_json(agent, &url, &headers)?;
    let mut runs = Vec::new();
    for pipeline in body
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(CIRCLE_PIPELINES)
    {
        let (Some(id), Some(commit)) = (str_at(pipeline, "/id"), str_at(pipeline, "/vcs/revision"))
        else {
            continue;
        };
        let number = str_at(pipeline, "/number").unwrap_or_default();
        let url = format!("https://circleci.com/api/v2/pipeline/{id}/workflow");
        let Ok(workflows) = get_json(agent, &url, &headers) else {
            continue;
        };
        for workflow in workflows
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let status = match str_at(workflow, "/status").as_deref() {
                Some("success") => CiRunStatus::Success,
                Some("running" | "failing") => CiRunStatus::Running,
                Some("failed" | "error" | "unauthorized") => CiRunStatus::Failure,
                Some("canceled") => CiRunStatus::Cancelled,
                Some("not_run") => CiRunStatus::Skipped,
                _ => CiRunStatus::Queued,
            };
            let workflow_id = str_at(workflow, "/id").unwrap_or_default();
            runs.push(CiRun {
                provider: CiProvider::CircleCi,
                workflow: str_at(workflow, "/name").unwrap_or_else(|| "workflow".to_owned()),
                path: Some(".circleci/config.yml".to_owned()),
                commit: commit.clone(),
                branch: str_at(pipeline, "/vcs/branch").or_else(|| str_at(pipeline, "/vcs/tag")),
                event: str_at(pipeline, "/trigger/type"),
                status,
                url: Some(format!(
                    "https://app.circleci.com/pipelines/{vcs}/{}/{number}/workflows/{workflow_id}",
                    remote.path
                )),
                created: str_at(workflow, "/created_at"),
            });
        }
    }
    Ok(runs)
}

fn azure(
    agent: &ureq::Agent,
    (org, project, repo): &(String, String, String),
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let url = format!(
        "https://dev.azure.com/{}/{}/_apis/build/builds?api-version=7.0&$top={PAGE}",
        encode(org),
        encode(project)
    );
    let headers: Vec<(&str, String)> = token
        .map(|t| {
            vec![(
                "Authorization",
                format!("Basic {}", base64(format!(":{t}").as_bytes())),
            )]
        })
        .unwrap_or_default();
    let body = get_json(agent, &url, &headers)?;
    Ok(body
        .get("value")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        // The project's builds can come from other repositories too.
        .filter(|b| str_at(b, "/repository/name").is_none_or(|name| &name == repo))
        .filter_map(|b| {
            let status = match (
                str_at(b, "/status").as_deref(),
                str_at(b, "/result").as_deref(),
            ) {
                (Some("completed"), Some("succeeded")) => CiRunStatus::Success,
                (Some("completed"), Some("failed")) => CiRunStatus::Failure,
                (Some("completed"), Some("canceled")) | (Some("cancelling"), _) => {
                    CiRunStatus::Cancelled
                }
                (Some("completed"), _) => CiRunStatus::Neutral,
                (Some("inProgress"), _) => CiRunStatus::Running,
                _ => CiRunStatus::Queued,
            };
            Some(CiRun {
                provider: CiProvider::Azure,
                workflow: str_at(b, "/definition/name").unwrap_or_else(|| "pipeline".to_owned()),
                path: None,
                commit: str_at(b, "/sourceVersion")?,
                branch: str_at(b, "/sourceBranch").map(|s| {
                    s.strip_prefix("refs/heads/")
                        .or_else(|| s.strip_prefix("refs/tags/"))
                        .unwrap_or(&s)
                        .to_owned()
                }),
                event: str_at(b, "/reason"),
                status,
                url: str_at(b, "/_links/web/href"),
                created: str_at(b, "/queueTime"),
            })
        })
        .collect())
}

fn bitbucket(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let url = format!(
        "https://api.bitbucket.org/2.0/repositories/{}/pipelines/?sort=-created_on&pagelen=50",
        remote.path
    );
    // `user:app-password` is sent as Basic, anything else as a Bearer access token.
    let headers: Vec<(&str, String)> = match token {
        Some(t) if t.contains(':') => {
            vec![("Authorization", format!("Basic {}", base64(t.as_bytes())))]
        }
        other => bearer(other),
    };
    let body = get_json(agent, &url, &headers)?;
    Ok(body
        .get("values")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let status = match (
                str_at(p, "/state/name").as_deref(),
                str_at(p, "/state/result/name").as_deref(),
            ) {
                (Some("COMPLETED"), Some("SUCCESSFUL")) => CiRunStatus::Success,
                (Some("COMPLETED"), Some("FAILED" | "ERROR")) => CiRunStatus::Failure,
                (Some("COMPLETED"), Some("STOPPED" | "EXPIRED")) => CiRunStatus::Cancelled,
                (Some("COMPLETED"), _) | (Some("HALTED"), _) => CiRunStatus::Neutral,
                (Some("IN_PROGRESS"), _) => CiRunStatus::Running,
                _ => CiRunStatus::Queued,
            };
            let number = str_at(p, "/build_number").unwrap_or_default();
            Some(CiRun {
                provider: CiProvider::Bitbucket,
                workflow: "Bitbucket Pipelines".to_owned(),
                path: Some("bitbucket-pipelines.yml".to_owned()),
                commit: str_at(p, "/target/commit/hash")?,
                branch: str_at(p, "/target/ref_name"),
                event: str_at(p, "/trigger/name"),
                status,
                url: Some(format!(
                    "https://bitbucket.org/{}/pipelines/results/{number}",
                    remote.path
                )),
                created: str_at(p, "/created_on"),
            })
        })
        .collect())
}

fn travis(
    agent: &ureq::Agent,
    remote: &RemoteRepo,
    token: Option<&str>,
) -> Result<Vec<CiRun>, HttpError> {
    let url = format!(
        "https://api.travis-ci.com/repo/{}/builds?limit=50",
        encode(&remote.path)
    );
    let mut headers = vec![("Travis-API-Version", "3".to_owned())];
    if let Some(t) = token {
        headers.push(("Authorization", format!("token {t}")));
    }
    let body = get_json(agent, &url, &headers)?;
    Ok(body
        .get("builds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|b| {
            let status = match str_at(b, "/state").as_deref() {
                Some("passed") => CiRunStatus::Success,
                Some("failed" | "errored") => CiRunStatus::Failure,
                Some("canceled") => CiRunStatus::Cancelled,
                Some("started") => CiRunStatus::Running,
                _ => CiRunStatus::Queued,
            };
            let id = str_at(b, "/id").unwrap_or_default();
            Some(CiRun {
                provider: CiProvider::Travis,
                workflow: "Travis CI".to_owned(),
                path: Some(".travis.yml".to_owned()),
                commit: str_at(b, "/commit/sha")?,
                branch: str_at(b, "/branch/name"),
                event: str_at(b, "/event_type"),
                status,
                url: Some(format!(
                    "https://app.travis-ci.com/github/{}/builds/{id}",
                    remote.path
                )),
                created: str_at(b, "/started_at"),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_paths_and_base64() {
        assert_eq!(encode("group/sub repo"), "group%2Fsub%20repo");
        assert_eq!(base64(b":abc"), "OmFiYw==");
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"ab"), "YWI=");
    }
}
