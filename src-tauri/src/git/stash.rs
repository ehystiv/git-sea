use serde::Serialize;
use specta::Type;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// `n` in `stash@{n}`; 0 is the newest.
    pub index: u32,
    /// Reflog message, e.g. "WIP on main: 1a2b3c4 subject" or "On main: my note".
    pub message: String,
    /// The stash commit itself (not part of the graph).
    pub commit: String,
    /// The commit the stash was made on, which is in the graph.
    pub base: Option<String>,
}

fn git<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Git(e.to_string())
}

/// Stashes, newest first. They live in the reflog of `refs/stash`.
pub fn list_stashes(repo: &gix::Repository) -> Result<Vec<StashEntry>, AppError> {
    let Some(reference) = repo.try_find_reference("refs/stash").map_err(git)? else {
        return Ok(Vec::new());
    };
    let mut log = reference.log_iter();
    let Some(lines) = log.rev().map_err(git)? else {
        return Ok(Vec::new());
    };

    let mut entries = Vec::new();
    for (n, line) in lines.enumerate() {
        let line = line.map_err(git)?;
        let commit = line.new_oid;
        let base = repo
            .find_commit(commit)
            .ok()
            .and_then(|c| c.parent_ids().next())
            .map(|id| id.to_string());
        entries.push(StashEntry {
            index: u32::try_from(n).unwrap_or(u32::MAX),
            message: line.message.to_string(),
            commit: commit.to_string(),
            base,
        });
    }
    Ok(entries)
}
