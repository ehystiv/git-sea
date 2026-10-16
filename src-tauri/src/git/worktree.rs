//! The working copy: what is staged (HEAD compared with the index) and what is not (the index
//! compared with the files on disk, plus untracked files), like `git status`.

use std::path::Path;

use gix::status::index_worktree;
use gix::status::plumbing::index_as_worktree::{Change, EntryStatus};
use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::{
    ChangeStatus, FileChange, FileDiff, MAX_BLOB_BYTES, MAX_STATS_FILES, blob_at, content_diff,
    content_stats, git,
};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// The commit the changes sit on; `None` before the first commit and in a bare repository.
    pub head: Option<String>,
    /// HEAD compared with the index, ordered by path.
    pub staged: Vec<FileChange>,
    /// The index compared with the files on disk, untracked files included, ordered by path.
    pub unstaged: Vec<FileChange>,
    /// Files with any change, staged or not, each counted once.
    pub files: u32,
}

/// What `git status` would list. A bare repository has no working copy, hence no changes.
pub fn worktree_status(repo: &gix::Repository) -> Result<WorktreeStatus, AppError> {
    let head = repo.head_id().ok().map(|id| id.to_string());
    let mut status = WorktreeStatus {
        head,
        staged: Vec::new(),
        unstaged: Vec::new(),
        files: 0,
    };
    if repo.workdir().is_none() {
        return Ok(status);
    }

    let items = repo
        .status(gix::progress::Discard)
        .map_err(git)?
        .untracked_files(gix::status::UntrackedFiles::Files)
        .index_worktree_rewrites(None)
        .into_iter(Vec::new())
        .map_err(git)?;
    for item in items {
        match item.map_err(git)? {
            gix::status::Item::TreeIndex(change) => status.staged.push(staged_change(&change)),
            gix::status::Item::IndexWorktree(item) => {
                if let Some(change) = unstaged_change(&item) {
                    status.unstaged.push(change);
                }
            }
        }
    }
    status.staged.sort_by(|a, b| a.path.cmp(&b.path));
    status.unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    let mut paths: Vec<&str> = status
        .staged
        .iter()
        .chain(&status.unstaged)
        .map(|f| f.path.as_str())
        .collect();
    paths.sort_unstable();
    paths.dedup();
    status.files = u32::try_from(paths.len()).unwrap_or(u32::MAX);

    add_stats(repo, &mut status.staged, true);
    add_stats(repo, &mut status.unstaged, false);
    Ok(status)
}

fn file(path: &[u8], old_path: Option<&[u8]>, status: ChangeStatus, submodule: bool) -> FileChange {
    FileChange {
        path: String::from_utf8_lossy(path).into_owned(),
        old_path: old_path.map(|p| String::from_utf8_lossy(p).into_owned()),
        status,
        additions: None,
        deletions: None,
        // Submodule pointers have no file content to show.
        binary: submodule,
    }
}

fn is_submodule(mode: gix::index::entry::Mode) -> bool {
    mode == gix::index::entry::Mode::COMMIT
}

fn staged_change(change: &gix::diff::index::Change) -> FileChange {
    use gix::diff::index::ChangeRef;
    match change {
        ChangeRef::Addition {
            location,
            entry_mode,
            ..
        } => file(
            location,
            None,
            ChangeStatus::Added,
            is_submodule(*entry_mode),
        ),
        ChangeRef::Deletion {
            location,
            entry_mode,
            ..
        } => file(
            location,
            None,
            ChangeStatus::Deleted,
            is_submodule(*entry_mode),
        ),
        ChangeRef::Modification {
            location,
            previous_entry_mode,
            entry_mode,
            ..
        } => {
            let status = if previous_entry_mode == entry_mode {
                ChangeStatus::Modified
            } else {
                ChangeStatus::TypeChange
            };
            file(location, None, status, is_submodule(*entry_mode))
        }
        ChangeRef::Rewrite {
            source_location,
            location,
            entry_mode,
            ..
        } => file(
            location,
            Some(source_location),
            ChangeStatus::Renamed,
            is_submodule(*entry_mode),
        ),
    }
}

fn unstaged_change(item: &index_worktree::Item) -> Option<FileChange> {
    match item {
        index_worktree::Item::Modification {
            rela_path,
            status,
            entry,
            ..
        } => {
            let kind = match status {
                // Only the file's timestamps differ from what the index remembers.
                EntryStatus::NeedsUpdate(_) => return None,
                EntryStatus::IntentToAdd => ChangeStatus::Added,
                EntryStatus::Change(Change::Removed) => ChangeStatus::Deleted,
                EntryStatus::Change(Change::Type { .. }) => ChangeStatus::TypeChange,
                EntryStatus::Conflict { .. } | EntryStatus::Change(_) => ChangeStatus::Modified,
            };
            Some(file(rela_path, None, kind, is_submodule(entry.mode)))
        }
        index_worktree::Item::DirectoryContents { entry, .. } => (entry.status
            == gix::dir::entry::Status::Untracked)
            .then(|| file(&entry.rela_path, None, ChangeStatus::Added, false)),
        // Renames between the index and the working copy are not tracked (see `worktree_status`).
        index_worktree::Item::Rewrite { .. } => None,
    }
}

fn add_stats(repo: &gix::Repository, files: &mut [FileChange], staged: bool) {
    for change in files.iter_mut().filter(|f| !f.binary).take(MAX_STATS_FILES) {
        let Ok((old, new)) = contents(repo, change, staged) else {
            continue;
        };
        if let (Some(old), Some(new)) = (old, new)
            && let Some((added, removed, binary)) = content_stats(&old, &new)
        {
            change.binary = binary;
            if !binary {
                change.additions = Some(added);
                change.deletions = Some(removed);
            }
        }
    }
}

/// Both sides of a change: HEAD and the index when staged, the index and the disk when not.
/// A side is empty when the file does not exist there, and `None` when it is too big to read.
#[allow(clippy::type_complexity)]
fn contents(
    repo: &gix::Repository,
    change: &FileChange,
    staged: bool,
) -> Result<(Option<Vec<u8>>, Option<Vec<u8>>), AppError> {
    let path = change.path.as_str();
    if staged {
        let old = match head_tree(repo)? {
            Some(tree) => blob_at(repo, &tree, change.old_path.as_deref().unwrap_or(path))?,
            None => None,
        };
        Ok((Some(old.unwrap_or_default()), Some(index_blob(repo, path)?)))
    } else {
        Ok((Some(index_blob(repo, path)?), on_disk(repo, path)?))
    }
}

fn head_tree(repo: &gix::Repository) -> Result<Option<gix::Tree<'_>>, AppError> {
    match repo.head_commit() {
        Ok(commit) => Ok(Some(commit.tree().map_err(git)?)),
        // No commit yet: everything in the index is new.
        Err(_) => Ok(None),
    }
}

/// The file's content in the index; empty when it is not there.
fn index_blob(repo: &gix::Repository, path: &str) -> Result<Vec<u8>, AppError> {
    let index = repo.index_or_empty().map_err(git)?;
    let Some(entry) = index.entry_by_path(path.into()) else {
        return Ok(Vec::new());
    };
    if is_submodule(entry.mode) {
        return Ok(Vec::new());
    }
    let object = repo.find_object(entry.id).map_err(git)?;
    Ok(object.data.clone())
}

/// The file's content on disk (a symlink's target, as git stores it); empty when it is gone,
/// `None` when it is too big to diff.
fn on_disk(repo: &gix::Repository, path: &str) -> Result<Option<Vec<u8>>, AppError> {
    let Some(workdir) = repo.workdir() else {
        return Ok(Some(Vec::new()));
    };
    let full = workdir.join(Path::new(path));
    let Ok(meta) = std::fs::symlink_metadata(&full) else {
        return Ok(Some(Vec::new()));
    };
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(&full).map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(Some(target.to_string_lossy().into_owned().into_bytes()));
    }
    if !meta.is_file() {
        return Ok(Some(Vec::new()));
    }
    if meta.len() > MAX_BLOB_BYTES as u64 {
        return Ok(None);
    }
    std::fs::read(&full)
        .map(Some)
        .map_err(|e| AppError::Internal(e.to_string()))
}

/// Line diff of one file of the working copy: HEAD → index when `staged`, else index → disk.
/// `old_path` is the file's previous path when a staged rename moved it.
pub fn worktree_diff(
    repo: &gix::Repository,
    path: &str,
    old_path: Option<&str>,
    staged: bool,
) -> Result<FileDiff, AppError> {
    let change = FileChange {
        path: path.to_owned(),
        old_path: old_path.map(ToOwned::to_owned),
        status: ChangeStatus::Modified,
        additions: None,
        deletions: None,
        binary: false,
    };
    match contents(repo, &change, staged)? {
        (Some(old), Some(new)) => Ok(content_diff(path, &old, &new)),
        _ => Ok(FileDiff {
            path: path.to_owned(),
            binary: false,
            too_large: true,
            truncated: false,
            hunks: Vec::new(),
        }),
    }
}
