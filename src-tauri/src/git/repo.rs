use std::path::Path;

use serde::Serialize;
use specta::Type;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind")]
pub enum HeadInfo {
    /// HEAD points to an existing branch.
    Branch { name: String, commit: String },
    /// HEAD points directly to a commit.
    Detached { commit: String },
    /// HEAD points to a branch with no commits yet (fresh `git init`).
    Unborn { name: String },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Identifies the open repository in every later command.
    pub session_id: String,
    pub name: String,
    pub path: String,
    pub head: HeadInfo,
    /// Number of references under `refs/` (branches, remote branches, tags, stash).
    pub ref_count: u32,
    pub is_bare: bool,
}

/// Opens the repository at exactly `path` (no upward discovery) and summarises it.
/// Returns the thread-safe handle so the caller can keep it in a session.
pub fn open(
    path: &Path,
    session_id: String,
) -> Result<(RepoInfo, gix::ThreadSafeRepository), AppError> {
    if !path.exists() {
        return Err(AppError::PathNotFound(path.display().to_string()));
    }

    // gix reports open failures as an opaque error, so tell "not a repo" apart up front.
    if !looks_like_repo(path) {
        return Err(AppError::NotARepository(path.display().to_string()));
    }
    let repo = gix::open(path).map_err(|e| AppError::Git(e.to_string()))?;

    let head = repo.head().map_err(|e| AppError::Git(e.to_string()))?;
    let head_info = if let Some(id) = head.id() {
        match head.referent_name() {
            Some(name) => HeadInfo::Branch {
                name: name.shorten().to_string(),
                commit: id.to_string(),
            },
            None => HeadInfo::Detached {
                commit: id.to_string(),
            },
        }
    } else {
        HeadInfo::Unborn {
            name: head
                .referent_name()
                .map(|n| n.shorten().to_string())
                .unwrap_or_else(|| "HEAD".to_string()),
        }
    };

    let refs = repo
        .references()
        .map_err(|e| AppError::Git(e.to_string()))?;
    let ref_count = refs
        .all()
        .map_err(|e| AppError::Git(e.to_string()))?
        .filter_map(|r| match r {
            Ok(reference) => Some(reference),
            Err(err) => {
                tracing::warn!(%err, "skipping unreadable reference");
                None
            }
        })
        .count();

    let info = RepoInfo {
        session_id,
        name: repo_name(&repo, path),
        path: path.display().to_string(),
        head: head_info,
        ref_count: u32::try_from(ref_count).unwrap_or(u32::MAX),
        is_bare: repo.is_bare(),
    };
    Ok((info, repo.into_sync()))
}

/// A working tree has `.git` (directory or file, for worktrees/submodules); a bare repo has `HEAD` and `objects/`.
fn looks_like_repo(path: &Path) -> bool {
    path.join(".git").exists() || (path.join("HEAD").is_file() && path.join("objects").is_dir())
}

fn repo_name(repo: &gix::Repository, fallback: &Path) -> String {
    let base = repo.workdir().unwrap_or_else(|| repo.git_dir());
    let name = base
        .file_name()
        .or_else(|| fallback.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "repository".to_string());
    name.strip_suffix(".git").map(str::to_owned).unwrap_or(name)
}

/// True for a partial clone, whose trees or blobs are fetched on demand by git and may be missing.
pub fn is_partial_clone(repo: &gix::Repository) -> bool {
    let config = repo.config_snapshot();
    if config.string("extensions.partialClone").is_some() {
        return true;
    }
    repo.remote_names()
        .iter()
        .any(|name| config.boolean(format!("remote.{name}.promisor").as_str()) == Some(true))
}

/// A git error, told apart as missing objects when the repository is a partial clone: then the
/// cause is almost always an object that was never fetched.
pub fn in_partial_clone(repo: &gix::Repository, err: AppError) -> AppError {
    match err {
        AppError::Git(message) if is_partial_clone(repo) => AppError::MissingObjects(message),
        other => other,
    }
}
