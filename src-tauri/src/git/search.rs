//! Searches that need more than the commit summaries the frontend already has: the whole commit
//! message, the commits that changed a path, and the commits that added or removed a text.

use std::collections::HashMap;
use std::time::Instant;

use gix::bstr::ByteSlice;
use gix::object::tree::diff::ChangeDetached;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;
use crate::git::diff::MAX_BLOB_BYTES;

/// More matches than this are cut; the frontend says the list is incomplete.
pub const MAX_RESULTS: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SearchField {
    /// The whole commit message (subject and body), case-insensitive.
    Message,
    /// Commits whose first-parent diff touches a file or directory (path relative to the root).
    Path,
    /// Commits that change how many times a text appears in some file, against their first
    /// parent (like `git log -S`): they add or remove it. Case-sensitive.
    Diff,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Full hex ids of the matching commits, in no particular order.
    pub ids: Vec<String>,
    /// More commits matched than `MAX_RESULTS`.
    pub truncated: bool,
    /// The search was cancelled by a newer one; `ids` is incomplete.
    pub cancelled: bool,
    #[specta(type = f64)]
    pub elapsed_ms: u64,
}

fn git<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Git(e.to_string())
}

/// `./src/lib/` and `/src/lib` both mean `src/lib`.
pub fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    let trimmed = trimmed.strip_prefix("./").unwrap_or(trimmed);
    trimmed.trim_matches('/').to_owned()
}

/// Walks every commit reachable from `tips` and returns those matching `text` in `field`.
/// `cancelled` is polled between commits.
pub fn search_commits(
    repo: &gix::Repository,
    tips: Vec<gix::ObjectId>,
    field: SearchField,
    text: &str,
    cancelled: &dyn Fn() -> bool,
) -> Result<SearchResult, AppError> {
    let start = Instant::now();
    let needle = match field {
        SearchField::Message => text.trim().to_lowercase(),
        SearchField::Path => normalize_path(text),
        // Spaces can be part of the code looked for; only an all-blank text means nothing.
        SearchField::Diff if text.trim().is_empty() => String::new(),
        SearchField::Diff => text.to_owned(),
    };
    let mut ids = Vec::new();
    let mut truncated = false;
    let mut was_cancelled = false;

    if !needle.is_empty() {
        let mut entries = EntryMemo::default();
        let walk = repo.rev_walk(tips).all().map_err(git)?;
        for info in walk {
            if cancelled() {
                was_cancelled = true;
                break;
            }
            let info = info.map_err(git)?;
            let matched = match field {
                SearchField::Message => {
                    let commit = repo.find_commit(info.id).map_err(git)?;
                    let message = commit.message_raw_sloppy();
                    String::from_utf8_lossy(message)
                        .to_lowercase()
                        .contains(&needle)
                }
                SearchField::Path => {
                    let own = entries.get(repo, info.id, &needle)?;
                    match info.parent_ids.first() {
                        Some(&parent) => own != entries.get(repo, parent, &needle)?,
                        None => own.is_some(),
                    }
                }
                SearchField::Diff => {
                    changes_occurrences(repo, info.id, info.parent_ids.first().copied(), &needle)?
                }
            };
            if matched {
                if ids.len() == MAX_RESULTS {
                    truncated = true;
                    break;
                }
                ids.push(info.id.to_string());
            }
        }
    }

    Ok(SearchResult {
        ids,
        truncated,
        cancelled: was_cancelled,
        elapsed_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    })
}

/// Whether some file changed by `commit` (against `parent`, or the empty tree for a root) holds
/// `needle` a different number of times before and after. Renames are detected as git's
/// configuration says (on by default), so a file moved without changing the text is no match, as
/// with `git log -S`.
fn changes_occurrences(
    repo: &gix::Repository,
    commit: gix::ObjectId,
    parent: Option<gix::ObjectId>,
    needle: &str,
) -> Result<bool, AppError> {
    let tree = repo.find_commit(commit).map_err(git)?.tree().map_err(git)?;
    let parent_tree = match parent {
        Some(id) => Some(repo.find_commit(id).map_err(git)?.tree().map_err(git)?),
        None => None,
    };
    let changes = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(git)?;
    let needle = needle.as_bytes();
    let count = |id: Option<gix::ObjectId>| -> Result<usize, AppError> {
        let Some(id) = id else { return Ok(0) };
        let object = repo.find_object(id).map_err(git)?;
        if object.data.len() > MAX_BLOB_BYTES {
            return Ok(0);
        }
        Ok(object.data.find_iter(needle).count())
    };
    for change in &changes {
        let (old, new, blob) = match change {
            ChangeDetached::Addition { id, entry_mode, .. } => {
                (None, Some(*id), entry_mode.is_blob())
            }
            ChangeDetached::Deletion { id, entry_mode, .. } => {
                (Some(*id), None, entry_mode.is_blob())
            }
            ChangeDetached::Modification {
                previous_id,
                id,
                entry_mode,
                previous_entry_mode,
                ..
            } => (
                previous_entry_mode.is_blob().then_some(*previous_id),
                entry_mode.is_blob().then_some(*id),
                entry_mode.is_blob() || previous_entry_mode.is_blob(),
            ),
            ChangeDetached::Rewrite {
                source_id,
                id,
                entry_mode,
                ..
            } => (Some(*source_id), Some(*id), entry_mode.is_blob()),
        };
        if blob && count(old)? != count(new)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The object a path points to in each commit's tree. A commit is usually asked about twice (as
/// itself, then as its child's parent), so remembering the answer halves the tree lookups.
#[derive(Default)]
struct EntryMemo(HashMap<gix::ObjectId, Option<gix::ObjectId>>);

impl EntryMemo {
    fn get(
        &mut self,
        repo: &gix::Repository,
        commit: gix::ObjectId,
        path: &str,
    ) -> Result<Option<gix::ObjectId>, AppError> {
        if let Some(&known) = self.0.get(&commit) {
            return Ok(known);
        }
        let tree = repo.find_commit(commit).map_err(git)?.tree().map_err(git)?;
        let entry = tree
            .lookup_entry_by_path(path)
            .map_err(git)?
            .map(|e| e.object_id());
        self.0.insert(commit, entry);
        Ok(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_path;

    #[test]
    fn paths_lose_leading_dot_slash_and_outer_slashes() {
        assert_eq!(normalize_path(" ./src/lib/ "), "src/lib");
        assert_eq!(normalize_path("/README.md"), "README.md");
        assert_eq!(normalize_path("/"), "");
    }
}
