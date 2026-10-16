//! Searches that need more than the commit summaries the frontend already has: the whole commit
//! message, and the commits that changed a path.

use std::collections::HashMap;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::AppError;

/// More matches than this are cut; the frontend says the list is incomplete.
pub const MAX_RESULTS: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SearchField {
    /// The whole commit message (subject and body), case-insensitive.
    Message,
    /// Commits whose first-parent diff touches a file or directory (path relative to the root).
    Path,
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
