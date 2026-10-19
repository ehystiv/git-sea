//! Blame of one file at a commit: for every line, the commit that last changed it. Renames are
//! followed, as git's configuration says (on by default).

use std::collections::HashSet;

use gix::bstr::ByteSlice;
use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::{MAX_BLOB_BYTES, git, parse_id};

/// A run of consecutive lines that came from the same commit.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameHunk {
    /// 0-based index of the first line of the run in the blamed file.
    pub start: u32,
    pub len: u32,
    /// Full hex id of the commit that introduced the lines.
    pub commit: String,
    /// 1-based line number of the first line in that commit's version of the file.
    pub source_line: u32,
    /// The file's path in that commit, when it was different (the file was renamed since).
    pub source_path: Option<String>,
}

/// What the blame view shows about a commit, so commits outside the loaded graph (the branch
/// filter hides them) still have a summary.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BlameCommit {
    pub id: String,
    pub summary: String,
    pub author: String,
    /// Author time, seconds since the Unix epoch.
    #[specta(type = f64)]
    pub time: i64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileBlame {
    pub path: String,
    pub binary: bool,
    /// The file is too big to blame.
    pub too_large: bool,
    /// The file's lines, without their line endings.
    pub lines: Vec<String>,
    /// In file order, covering every line.
    pub hunks: Vec<BlameHunk>,
    /// Every commit named by a hunk, once.
    pub commits: Vec<BlameCommit>,
}

/// Blames `path` as it is in `commit_id`.
pub fn blame_file(
    repo: &gix::Repository,
    commit_id: &str,
    path: &str,
) -> Result<FileBlame, AppError> {
    let id = parse_id(commit_id)?;
    let tree = repo.find_commit(id).map_err(git)?.tree().map_err(git)?;
    let content = crate::git::diff::blob_at(repo, &tree, path)?
        .ok_or_else(|| AppError::Git(format!("{path} is not a file in {commit_id}")))?;

    let mut result = FileBlame {
        path: path.to_owned(),
        binary: false,
        too_large: false,
        lines: Vec::new(),
        hunks: Vec::new(),
        commits: Vec::new(),
    };
    if content.iter().take(8_000).any(|&b| b == 0) {
        result.binary = true;
        return Ok(result);
    }
    if content.len() > MAX_BLOB_BYTES {
        result.too_large = true;
        return Ok(result);
    }
    result.lines = String::from_utf8_lossy(&content)
        .split_inclusive('\n')
        .map(|l| l.strip_suffix('\n').unwrap_or(l))
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_owned())
        .collect();
    if result.lines.is_empty() {
        return Ok(result);
    }

    let options = gix::repository::blame_file::Options {
        rewrites: Some(gix::diff::Rewrites::default()),
        ..Default::default()
    };
    let outcome = repo
        .blame_file(path.as_bytes().as_bstr(), id, options)
        .map_err(git)?;

    let mut seen = HashSet::new();
    for entry in &outcome.entries {
        if seen.insert(entry.commit_id) {
            result.commits.push(blame_commit(repo, entry.commit_id)?);
        }
        result.hunks.push(BlameHunk {
            start: entry.start_in_blamed_file,
            len: entry.len.get(),
            commit: entry.commit_id.to_string(),
            source_line: entry.start_in_source_file + 1,
            source_path: entry
                .source_file_name
                .as_ref()
                .map(|name| name.to_str_lossy().into_owned())
                .filter(|name| name != path),
        });
    }
    result.hunks.sort_by_key(|h| h.start);
    Ok(result)
}

fn blame_commit(repo: &gix::Repository, id: gix::ObjectId) -> Result<BlameCommit, AppError> {
    let commit = repo.find_commit(id).map_err(git)?;
    let author = commit.author().map_err(git)?;
    Ok(BlameCommit {
        id: id.to_string(),
        summary: commit.message().map_err(git)?.summary().to_string(),
        author: author.name.to_string(),
        time: author.seconds(),
    })
}
