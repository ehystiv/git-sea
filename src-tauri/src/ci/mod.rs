//! Continuous integration: the workflow files of the repository (read from HEAD), which refs a
//! push or a pull request would start them on, and the runs the CI services report.

pub mod auth;
pub mod gitlab;
pub mod pattern;
pub mod providers;
pub mod pulls;
pub mod remote;
pub mod runs;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;
use crate::git::commits::{RefKind, RefLabel};
use pattern::Filter;
use remote::RemoteRepo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub enum CiProvider {
    GitHub,
    GitLab,
    CircleCi,
    Azure,
    Bitbucket,
    Travis,
    Jenkins,
}

impl CiProvider {
    /// Name of the token in the Keychain.
    pub fn key(self) -> &'static str {
        match self {
            CiProvider::GitHub => "github",
            CiProvider::GitLab => "gitlab",
            CiProvider::CircleCi => "circleci",
            CiProvider::Azure => "azure",
            CiProvider::Bitbucket => "bitbucket",
            CiProvider::Travis => "travis",
            CiProvider::Jenkins => "jenkins",
        }
    }
}

/// A branch or tag name, as a push would send it.
#[derive(Debug, Clone, Copy)]
pub enum RefName<'a> {
    Branch(&'a str),
    Tag(&'a str),
}

impl<'a> RefName<'a> {
    pub fn name(&self) -> &'a str {
        match self {
            RefName::Branch(n) | RefName::Tag(n) => n,
        }
    }
}

/// What starts a workflow, in a form that can be asked about any ref.
pub enum Matcher {
    Filters {
        branches: Filter,
        tags: Filter,
        /// Target branches of a pull request / merge request.
        merge: Filter,
    },
    GitLab(Box<gitlab::Pipeline>),
}

/// A workflow read from a file.
pub struct Definition {
    pub provider: CiProvider,
    pub name: String,
    pub path: String,
    pub events: Vec<String>,
    pub approximate: bool,
    pub matcher: Matcher,
}

impl Definition {
    pub fn on_push(&self, name: RefName<'_>, default_branch: Option<&str>) -> bool {
        match &self.matcher {
            Matcher::Filters { branches, tags, .. } => match name {
                RefName::Branch(n) => branches.matches(n),
                RefName::Tag(n) => tags.matches(n),
            },
            Matcher::GitLab(p) => p.triggers(gitlab::Event::Push(name), default_branch),
        }
    }

    pub fn on_merge(&self, target: &str, default_branch: Option<&str>) -> bool {
        match &self.matcher {
            Matcher::Filters { merge, .. } => merge.matches(target),
            Matcher::GitLab(p) => {
                p.triggers(gitlab::Event::MergeRequest { target }, default_branch)
            }
        }
    }
}

// ---- what the frontend gets ------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiWorkflow {
    /// Position in `CiOverview::workflows`; triggers refer to workflows by it.
    pub id: u32,
    pub provider: CiProvider,
    pub name: String,
    /// File it is defined in, from the root of the repository.
    pub path: String,
    /// Events that start it, as the provider names them (`push`, `pull_request`, `schedule`…).
    pub events: Vec<String>,
    /// Some of its conditions (changed files, variables) were not evaluated: the markers on the
    /// graph are a best guess.
    pub approximate: bool,
    /// Page of the workflow on the CI service, when the remote tells where it is.
    pub web_url: Option<String>,
}

/// A ref and the workflows a push of it (or a merge into it) would start.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiRefTrigger {
    pub kind: RefKind,
    /// Name as shown in the graph (`origin/main` for a remote branch).
    pub name: String,
    /// Name as the CI service sees it (`main`).
    pub branch: String,
    pub commit: String,
    pub workflows: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiProblem {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CiOverview {
    pub workflows: Vec<CiWorkflow>,
    /// Refs whose push would start at least one workflow.
    pub push: Vec<CiRefTrigger>,
    /// Branches a pull request or merge request into would start at least one workflow.
    pub merge_targets: Vec<CiRefTrigger>,
    /// Files that could not be read.
    pub problems: Vec<CiProblem>,
    pub default_branch: Option<String>,
}

// ---- reading the files -----------------------------------------------------------------------

const GITHUB_DIR: &str = ".github/workflows";
const SINGLE_FILES: &[(&str, CiProvider)] = &[
    (".gitlab-ci.yml", CiProvider::GitLab),
    (".circleci/config.yml", CiProvider::CircleCi),
    ("azure-pipelines.yml", CiProvider::Azure),
    (".azure-pipelines.yml", CiProvider::Azure),
    ("bitbucket-pipelines.yml", CiProvider::Bitbucket),
    (".travis.yml", CiProvider::Travis),
    ("Jenkinsfile", CiProvider::Jenkins),
];

/// Every workflow defined in HEAD's tree, and the files that could not be read.
pub fn read_definitions(
    repo: &gix::Repository,
) -> Result<(Vec<Definition>, Vec<CiProblem>), AppError> {
    let git = |e: &dyn std::fmt::Display| AppError::Git(e.to_string());
    let mut definitions = Vec::new();
    let mut problems = Vec::new();
    let Ok(head) = repo.head_commit() else {
        // Unborn HEAD: nothing committed yet.
        return Ok((definitions, problems));
    };
    let tree = head.tree().map_err(|e| git(&e))?;

    let mut files: Vec<(String, CiProvider)> = Vec::new();
    if let Some(entry) = tree.lookup_entry_by_path(GITHUB_DIR).map_err(|e| git(&e))?
        && entry.mode().is_tree()
    {
        let dir = repo.find_tree(entry.object_id()).map_err(|e| git(&e))?;
        let mut names: Vec<String> = dir
            .iter()
            .filter_map(Result::ok)
            .filter(|e| e.mode().is_blob())
            .map(|e| e.filename().to_string())
            .filter(|n| n.ends_with(".yml") || n.ends_with(".yaml"))
            .collect();
        names.sort();
        files.extend(
            names
                .into_iter()
                .map(|n| (format!("{GITHUB_DIR}/{n}"), CiProvider::GitHub)),
        );
    }
    files.extend(SINGLE_FILES.iter().map(|(p, k)| ((*p).to_owned(), *k)));

    for (path, provider) in files {
        let Some(data) = crate::git::diff::blob_at(repo, &tree, &path)? else {
            continue;
        };
        let text = String::from_utf8_lossy(&data);
        let parsed = match provider {
            CiProvider::GitHub => providers::github(&path, &text).map(|d| vec![d]),
            CiProvider::GitLab => providers::gitlab(&path, &text).map(|d| vec![d]),
            CiProvider::CircleCi => providers::circleci(&path, &text),
            CiProvider::Azure => providers::azure(&path, &text).map(|d| vec![d]),
            CiProvider::Bitbucket => providers::bitbucket(&path, &text).map(|d| vec![d]),
            CiProvider::Travis => providers::travis(&path, &text).map(|d| vec![d]),
            CiProvider::Jenkins => Ok(vec![providers::jenkins(&path)]),
        };
        match parsed {
            Ok(list) => definitions.extend(list),
            Err(message) => problems.push(CiProblem { path, message }),
        }
    }
    Ok((definitions, problems))
}

/// The branch the remote's HEAD points to (`origin/HEAD` → `main`), else HEAD's branch.
pub fn default_branch(repo: &gix::Repository) -> Option<String> {
    for remote in repo.remote_names() {
        let name = format!("refs/remotes/{remote}/HEAD");
        if let Ok(reference) = repo.find_reference(name.as_str())
            && let Some(target) = reference.target().try_name()
        {
            let full = target.as_bstr().to_string();
            let prefix = format!("refs/remotes/{remote}/");
            if let Some(branch) = full.strip_prefix(&prefix) {
                return Some(branch.to_owned());
            }
        }
    }
    let head = repo.head().ok()?;
    head.referent_name().map(|n| n.shorten().to_string())
}

/// What a remote-tracking branch is called on the remote: `origin/feature/x` → `feature/x`.
fn strip_remote<'a>(name: &'a str, remotes: &[String]) -> &'a str {
    remotes
        .iter()
        .filter_map(|r| name.strip_prefix(r.as_str())?.strip_prefix('/'))
        .next()
        .unwrap_or(name)
}

fn web_url(def: &Definition, remote: Option<&RemoteRepo>) -> Option<String> {
    let remote = remote?;
    match def.provider {
        CiProvider::GitHub if remote.is_github() => {
            let file = def.path.rsplit('/').next()?;
            Some(format!("{}/actions/workflows/{file}", remote.web()))
        }
        CiProvider::GitLab if remote.is_gitlab() => Some(format!("{}/-/pipelines", remote.web())),
        CiProvider::Bitbucket if remote.is_bitbucket() => {
            Some(format!("{}/pipelines", remote.web()))
        }
        CiProvider::CircleCi if remote.is_github() || remote.is_bitbucket() => {
            let vcs = if remote.is_github() {
                "github"
            } else {
                "bitbucket"
            };
            Some(format!(
                "https://app.circleci.com/pipelines/{vcs}/{}",
                remote.path
            ))
        }
        CiProvider::Travis if remote.is_github() => {
            Some(format!("https://app.travis-ci.com/github/{}", remote.path))
        }
        CiProvider::Azure => {
            let (org, project, _) = remote.azure()?;
            Some(format!("https://dev.azure.com/{org}/{project}/_build"))
        }
        _ => None,
    }
}

/// The workflows of the repository and the refs they would run on.
pub fn overview(repo: &gix::Repository, labels: &[RefLabel]) -> Result<CiOverview, AppError> {
    let (definitions, problems) = read_definitions(repo)?;
    let remote = remote::main_remote(repo);
    let default = default_branch(repo);
    Ok(evaluate(
        &definitions,
        problems,
        labels,
        &repo
            .remote_names()
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>(),
        remote.as_ref(),
        default,
    ))
}

/// The pure part of `overview`.
pub fn evaluate(
    definitions: &[Definition],
    problems: Vec<CiProblem>,
    labels: &[RefLabel],
    remotes: &[String],
    remote: Option<&RemoteRepo>,
    default: Option<String>,
) -> CiOverview {
    let workflows: Vec<CiWorkflow> = definitions
        .iter()
        .enumerate()
        .map(|(i, d)| CiWorkflow {
            id: u32::try_from(i).unwrap_or(u32::MAX),
            provider: d.provider,
            name: d.name.clone(),
            path: d.path.clone(),
            events: d.events.clone(),
            approximate: d.approximate,
            web_url: web_url(d, remote),
        })
        .collect();

    let default_ref = default.as_deref();
    let mut push = Vec::new();
    let mut merge_targets = Vec::new();
    // Many refs share a name (main, origin/main): ask each question once.
    let mut push_cache: HashMap<(bool, String), Vec<u32>> = HashMap::new();
    let mut merge_cache: HashMap<String, Vec<u32>> = HashMap::new();

    for label in labels {
        if label.name == "HEAD" {
            continue;
        }
        let is_tag = label.kind == RefKind::Tag;
        let branch = if label.kind == RefKind::Remote {
            strip_remote(&label.name, remotes)
        } else {
            label.name.as_str()
        };
        if branch == "HEAD" {
            continue;
        }
        let pushes = push_cache
            .entry((is_tag, branch.to_owned()))
            .or_insert_with(|| {
                let name = if is_tag {
                    RefName::Tag(branch)
                } else {
                    RefName::Branch(branch)
                };
                ids(definitions, |d| d.on_push(name, default_ref))
            })
            .clone();
        let trigger = |workflows: Vec<u32>| CiRefTrigger {
            kind: label.kind,
            name: label.name.clone(),
            branch: branch.to_owned(),
            commit: label.commit.clone(),
            workflows,
        };
        if !pushes.is_empty() {
            push.push(trigger(pushes));
        }
        if !is_tag {
            let merges = merge_cache
                .entry(branch.to_owned())
                .or_insert_with(|| ids(definitions, |d| d.on_merge(branch, default_ref)))
                .clone();
            if !merges.is_empty() {
                merge_targets.push(trigger(merges));
            }
        }
    }

    CiOverview {
        workflows,
        push,
        merge_targets,
        problems,
        default_branch: default,
    }
}

fn ids(definitions: &[Definition], keep: impl Fn(&Definition) -> bool) -> Vec<u32> {
    definitions
        .iter()
        .enumerate()
        .filter(|(_, d)| keep(d))
        .map(|(i, _)| u32::try_from(i).unwrap_or(u32::MAX))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn label(kind: RefKind, name: &str) -> RefLabel {
        RefLabel {
            commit: format!("c-{name}"),
            name: name.to_owned(),
            kind,
        }
    }

    #[test]
    fn remote_branches_are_matched_by_their_name_on_the_remote() {
        let text = "on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n";
        let defs = vec![providers::github(".github/workflows/ci.yml", text).unwrap()];
        let labels = [
            label(RefKind::Head, "main"),
            label(RefKind::Remote, "origin/main"),
            label(RefKind::Remote, "origin/feature"),
            label(RefKind::Tag, "main"),
        ];
        let remote = remote::parse("git@github.com:o/r.git");
        let o = evaluate(
            &defs,
            Vec::new(),
            &labels,
            &["origin".to_owned()],
            remote.as_ref(),
            Some("main".into()),
        );
        let names: Vec<&str> = o.push.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["main", "origin/main"]);
        assert_eq!(o.push[1].branch, "main");
        assert_eq!(o.merge_targets.len(), 2);
        assert_eq!(
            o.workflows[0].web_url.as_deref(),
            Some("https://github.com/o/r/actions/workflows/ci.yml")
        );
    }
}
