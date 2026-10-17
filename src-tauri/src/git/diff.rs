//! Commit details and per-file diffs. A commit is compared with its first parent (like
//! `git show --first-parent`) unless another base commit is given: another parent of a merge, or
//! any commit to compare two points of the history. A root commit without a base is compared with
//! the empty tree.

use gix::diff::blob::{Algorithm, InternedInput};
use gix::object::tree::diff::ChangeDetached;
use serde::Serialize;
use specta::Type;

use crate::error::AppError;

/// Line statistics are computed for at most this many files of a commit.
pub(crate) const MAX_STATS_FILES: usize = 400;
/// Blobs bigger than this are not diffed line by line.
pub(crate) const MAX_BLOB_BYTES: usize = 2 * 1024 * 1024;
/// A file diff is cut after this many lines.
const MAX_DIFF_LINES: usize = 20_000;
const CONTEXT: usize = 3;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub email: String,
    /// Seconds since the Unix epoch.
    #[specta(type = f64)]
    pub time: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum ChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    /// The kind of entry changed (file, symlink, submodule).
    TypeChange,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    /// Where the file was before, for renames.
    pub old_path: Option<String>,
    pub status: ChangeStatus,
    /// `None` for binary files, huge files, and files past the statistics limit.
    pub additions: Option<u32>,
    pub deletions: Option<u32>,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub id: String,
    pub summary: String,
    /// The message after the first line, trimmed.
    pub body: String,
    pub author: Person,
    pub committer: Person,
    pub parents: Vec<String>,
    /// The commit the files below were compared with (the first parent unless a base was given);
    /// `None` for a root commit.
    pub compared_with: Option<String>,
    pub files: Vec<FileChange>,
    /// True when some files have no line statistics only because of the limit.
    pub stats_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum LineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: LineKind,
    /// 1-based line number in the old file (not for added lines).
    pub old_no: Option<u32>,
    /// 1-based line number in the new file (not for deleted lines).
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub binary: bool,
    /// The file is too big to diff line by line.
    pub too_large: bool,
    /// The diff was cut at the line limit.
    pub truncated: bool,
    pub hunks: Vec<Hunk>,
}

pub(crate) fn git<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Git(e.to_string())
}

fn person(signature: gix::actor::SignatureRef<'_>) -> Person {
    Person {
        name: signature.name.to_string(),
        email: signature.email.to_string(),
        time: signature.seconds(),
    }
}

fn parse_id(hex: &str) -> Result<gix::ObjectId, AppError> {
    gix::ObjectId::from_hex(hex.as_bytes())
        .map_err(|_| AppError::Git(format!("not an object id: {hex}")))
}

fn first_parent_tree<'repo>(
    repo: &'repo gix::Repository,
    commit: &gix::Commit<'repo>,
) -> Result<Option<(gix::ObjectId, gix::Tree<'repo>)>, AppError> {
    let Some(parent_id) = commit.parent_ids().next() else {
        return Ok(None);
    };
    let parent = repo.find_commit(parent_id.detach()).map_err(git)?;
    let tree = parent.tree().map_err(git)?;
    Ok(Some((parent_id.detach(), tree)))
}

/// The tree to compare `commit` with: `base`'s when given, else the first parent's.
fn base_tree<'repo>(
    repo: &'repo gix::Repository,
    commit: &gix::Commit<'repo>,
    base: Option<&str>,
) -> Result<Option<(gix::ObjectId, gix::Tree<'repo>)>, AppError> {
    let Some(base) = base else {
        return first_parent_tree(repo, commit);
    };
    let base = repo.find_commit(parse_id(base)?).map_err(git)?;
    let tree = base.tree().map_err(git)?;
    Ok(Some((base.id, tree)))
}

pub fn commit_details(
    repo: &gix::Repository,
    commit_id: &str,
    base: Option<&str>,
) -> Result<CommitDetails, AppError> {
    let commit = repo.find_commit(parse_id(commit_id)?).map_err(git)?;
    let message = commit.message().map_err(git)?;
    let body = message
        .body()
        .map(|b| b.to_string().trim().to_owned())
        .unwrap_or_default();
    let new_tree = commit.tree().map_err(git)?;
    let parent = base_tree(repo, &commit, base)?;

    let changes = repo
        .diff_tree_to_tree(parent.as_ref().map(|(_, tree)| tree), Some(&new_tree), None)
        .map_err(git)?;

    let mut files: Vec<FileChange> = changes.iter().filter_map(file_change).collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    let mut stats_truncated = false;
    for (n, (file, change)) in files.iter_mut().zip(sorted_changes(&changes)).enumerate() {
        if file.binary {
            continue;
        }
        if n >= MAX_STATS_FILES {
            stats_truncated = true;
            break;
        }
        if let Some((added, removed, binary)) = line_stats(repo, change) {
            file.binary = binary;
            if !binary {
                file.additions = Some(added);
                file.deletions = Some(removed);
            }
        }
    }

    Ok(CommitDetails {
        id: commit.id.to_string(),
        summary: message.summary().to_string(),
        body,
        author: person(commit.author().map_err(git)?),
        committer: person(commit.committer().map_err(git)?),
        parents: commit.parent_ids().map(|id| id.to_string()).collect(),
        compared_with: parent.map(|(id, _)| id.to_string()),
        files,
        stats_truncated,
    })
}

/// The non-tree changes, ordered by path, matching the order of the `files` list.
fn sorted_changes(changes: &[ChangeDetached]) -> Vec<&ChangeDetached> {
    let mut list: Vec<&ChangeDetached> = changes
        .iter()
        .filter(|c| file_change(c).is_some())
        .collect();
    list.sort_by(|a, b| location(a).cmp(location(b)));
    list
}

fn location(change: &ChangeDetached) -> &[u8] {
    match change {
        ChangeDetached::Addition { location, .. }
        | ChangeDetached::Deletion { location, .. }
        | ChangeDetached::Modification { location, .. }
        | ChangeDetached::Rewrite { location, .. } => location.as_slice(),
    }
}

fn file_change(change: &ChangeDetached) -> Option<FileChange> {
    let (path, old_path, status, mode, is_tree) = match change {
        ChangeDetached::Addition {
            location,
            entry_mode,
            ..
        } => (
            location,
            None,
            ChangeStatus::Added,
            *entry_mode,
            entry_mode.is_tree(),
        ),
        ChangeDetached::Deletion {
            location,
            entry_mode,
            ..
        } => (
            location,
            None,
            ChangeStatus::Deleted,
            *entry_mode,
            entry_mode.is_tree(),
        ),
        ChangeDetached::Modification {
            location,
            previous_entry_mode,
            entry_mode,
            ..
        } => {
            let status = if previous_entry_mode.kind() == entry_mode.kind() {
                ChangeStatus::Modified
            } else {
                ChangeStatus::TypeChange
            };
            (location, None, status, *entry_mode, entry_mode.is_tree())
        }
        ChangeDetached::Rewrite {
            location,
            source_location,
            entry_mode,
            ..
        } => (
            location,
            Some(source_location),
            ChangeStatus::Renamed,
            *entry_mode,
            entry_mode.is_tree(),
        ),
    };
    if is_tree {
        return None;
    }
    Some(FileChange {
        path: path.to_string(),
        old_path: old_path.map(ToString::to_string),
        status,
        additions: None,
        deletions: None,
        // Submodule pointers have no file content to show.
        binary: mode.is_commit(),
    })
}

/// (additions, deletions, is_binary) for one change, or `None` when the content is too big.
fn line_stats(repo: &gix::Repository, change: &ChangeDetached) -> Option<(u32, u32, bool)> {
    let (old_id, new_id) = match change {
        ChangeDetached::Addition { id, .. } => (None, Some(*id)),
        ChangeDetached::Deletion { id, .. } => (Some(*id), None),
        ChangeDetached::Modification {
            previous_id, id, ..
        } => (Some(*previous_id), Some(*id)),
        ChangeDetached::Rewrite { source_id, id, .. } => (Some(*source_id), Some(*id)),
    };
    let old = old_id
        .map(|id| repo.find_object(id).ok().map(|o| o.data.clone()))
        .unwrap_or(Some(Vec::new()))?;
    let new = new_id
        .map(|id| repo.find_object(id).ok().map(|o| o.data.clone()))
        .unwrap_or(Some(Vec::new()))?;
    content_stats(&old, &new)
}

/// (additions, deletions, is_binary) between two contents, or `None` when one is too big.
pub(crate) fn content_stats(old: &[u8], new: &[u8]) -> Option<(u32, u32, bool)> {
    if is_binary(old) || is_binary(new) {
        return Some((0, 0, true));
    }
    if old.len() > MAX_BLOB_BYTES || new.len() > MAX_BLOB_BYTES {
        return None;
    }
    let (old, new) = (String::from_utf8_lossy(old), String::from_utf8_lossy(new));
    let input = InternedInput::new(old.as_ref(), new.as_ref());
    let diff = gix::diff::blob::diff_with_slider_heuristics(Algorithm::Histogram, &input);
    Some((diff.count_additions(), diff.count_removals(), false))
}

fn is_binary(data: &[u8]) -> bool {
    data.iter().take(8_000).any(|&b| b == 0)
}

/// Diff of one file of a commit against its first parent, or against `base` when given.
/// `old_path` is the file's previous path when it was renamed.
pub fn file_diff(
    repo: &gix::Repository,
    commit_id: &str,
    path: &str,
    old_path: Option<&str>,
    base: Option<&str>,
) -> Result<FileDiff, AppError> {
    let commit = repo.find_commit(parse_id(commit_id)?).map_err(git)?;
    let new_tree = commit.tree().map_err(git)?;
    let parent = base_tree(repo, &commit, base)?;

    let new = blob_at(repo, &new_tree, path)?;
    let old = match &parent {
        Some((_, tree)) => blob_at(repo, tree, old_path.unwrap_or(path))?,
        None => None,
    };
    Ok(content_diff(
        path,
        &old.unwrap_or_default(),
        &new.unwrap_or_default(),
    ))
}

/// Line diff between two contents of the file at `path`.
pub(crate) fn content_diff(path: &str, old: &[u8], new: &[u8]) -> FileDiff {
    let mut result = FileDiff {
        path: path.to_owned(),
        binary: false,
        too_large: false,
        truncated: false,
        hunks: Vec::new(),
    };
    if is_binary(old) || is_binary(new) {
        result.binary = true;
        return result;
    }
    if old.len() > MAX_BLOB_BYTES || new.len() > MAX_BLOB_BYTES {
        result.too_large = true;
        return result;
    }

    let (old, new) = (String::from_utf8_lossy(old), String::from_utf8_lossy(new));
    (result.hunks, result.truncated) = build_hunks(&old, &new);
    result
}

pub(crate) fn blob_at(
    repo: &gix::Repository,
    tree: &gix::Tree<'_>,
    path: &str,
) -> Result<Option<Vec<u8>>, AppError> {
    let Some(entry) = tree.lookup_entry_by_path(path).map_err(git)? else {
        return Ok(None);
    };
    if entry.mode().is_commit() || entry.mode().is_tree() {
        return Ok(None);
    }
    let object = repo.find_object(entry.object_id()).map_err(git)?;
    Ok(Some(object.data.clone()))
}

fn lines_of(text: &str) -> Vec<&str> {
    text.split_inclusive('\n')
        .map(|l| l.strip_suffix('\n').unwrap_or(l))
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Groups the line changes of `old` → `new` into unified-diff hunks with `CONTEXT` lines around
/// them. Returns the hunks and whether they were cut at `MAX_DIFF_LINES`.
pub fn build_hunks(old: &str, new: &str) -> (Vec<Hunk>, bool) {
    let input = InternedInput::new(old, new);
    let diff = gix::diff::blob::diff_with_slider_heuristics(Algorithm::Histogram, &input);
    let (old_lines, new_lines) = (lines_of(old), lines_of(new));

    let changes: Vec<(usize, usize, usize, usize)> = diff
        .hunks()
        .map(|h| {
            (
                h.before.start as usize,
                h.before.end as usize,
                h.after.start as usize,
                h.after.end as usize,
            )
        })
        .collect();

    let mut hunks = Vec::new();
    let mut emitted = 0usize;
    let mut i = 0;
    while i < changes.len() {
        // Changes closer than two contexts apart share a hunk.
        let mut j = i;
        while j + 1 < changes.len() && changes[j + 1].0 - changes[j].1 <= CONTEXT * 2 {
            j += 1;
        }
        let (first_old, _, first_new, _) = changes[i];
        let (_, last_old_end, _, _) = changes[j];
        let old_from = first_old.saturating_sub(CONTEXT);
        let new_from = first_new.saturating_sub(CONTEXT);
        let old_to = (last_old_end + CONTEXT).min(old_lines.len());

        let mut lines = Vec::new();
        let (mut o, mut n) = (old_from, new_from);
        let context =
            |lines: &mut Vec<DiffLine>, o: &mut usize, n: &mut usize, until_old: usize| {
                while *o < until_old {
                    lines.push(DiffLine {
                        kind: LineKind::Context,
                        old_no: Some(count(*o + 1)),
                        new_no: Some(count(*n + 1)),
                        text: old_lines.get(*o).copied().unwrap_or_default().to_owned(),
                    });
                    *o += 1;
                    *n += 1;
                }
            };
        for &(b0, b1, a0, a1) in &changes[i..=j] {
            context(&mut lines, &mut o, &mut n, b0);
            for line in b0..b1 {
                lines.push(DiffLine {
                    kind: LineKind::Del,
                    old_no: Some(count(line + 1)),
                    new_no: None,
                    text: old_lines.get(line).copied().unwrap_or_default().to_owned(),
                });
            }
            for line in a0..a1 {
                lines.push(DiffLine {
                    kind: LineKind::Add,
                    old_no: None,
                    new_no: Some(count(line + 1)),
                    text: new_lines.get(line).copied().unwrap_or_default().to_owned(),
                });
            }
            o = b1;
            n = a1;
        }
        context(&mut lines, &mut o, &mut n, old_to);

        emitted += lines.len();
        hunks.push(Hunk {
            old_start: count(old_from + 1),
            old_lines: count(o - old_from),
            new_start: count(new_from + 1),
            new_lines: count(n - new_from),
            lines,
        });
        if emitted >= MAX_DIFF_LINES {
            return (hunks, j + 1 < changes.len());
        }
        i = j + 1;
    }
    (hunks, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(hunk: &Hunk) -> String {
        hunk.lines
            .iter()
            .map(|l| match l.kind {
                LineKind::Context => ' ',
                LineKind::Add => '+',
                LineKind::Del => '-',
            })
            .collect()
    }

    #[test]
    fn a_single_change_gets_three_lines_of_context() {
        let old = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
        let new = "1\n2\n3\n4\nfive\n6\n7\n8\n9\n";

        let (hunks, truncated) = build_hunks(old, new);

        assert!(!truncated);
        assert_eq!(hunks.len(), 1);
        let hunk = &hunks[0];
        assert_eq!(kinds(hunk), "   -+   ");
        assert_eq!((hunk.old_start, hunk.old_lines), (2, 7));
        assert_eq!((hunk.new_start, hunk.new_lines), (2, 7));
        let deleted = hunk.lines.iter().find(|l| l.kind == LineKind::Del).unwrap();
        assert_eq!(
            (deleted.text.as_str(), deleted.old_no, deleted.new_no),
            ("5", Some(5), None)
        );
        let added = hunk.lines.iter().find(|l| l.kind == LineKind::Add).unwrap();
        assert_eq!(
            (added.text.as_str(), added.old_no, added.new_no),
            ("five", None, Some(5))
        );
    }

    #[test]
    fn distant_changes_make_separate_hunks_and_close_ones_merge() {
        let old: String = (1..=30).map(|i| format!("{i}\n")).collect();
        let far = old
            .replacen("3\n", "three\n", 1)
            .replacen("28\n", "twenty-eight\n", 1);
        assert_eq!(build_hunks(&old, &far).0.len(), 2);

        let near = old
            .replacen("10\n", "ten\n", 1)
            .replacen("14\n", "fourteen\n", 1);
        let (hunks, _) = build_hunks(&old, &near);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines.len(), 3 + 1 + 1 + 3 + 1 + 1 + 3);
    }

    #[test]
    fn additions_and_deletions_at_the_edges_are_handled() {
        let (hunks, _) = build_hunks("", "a\nb\n");
        assert_eq!(kinds(&hunks[0]), "++");
        assert_eq!((hunks[0].old_start, hunks[0].old_lines), (1, 0));

        let (hunks, _) = build_hunks("a\nb\n", "");
        assert_eq!(kinds(&hunks[0]), "--");
        assert_eq!((hunks[0].new_start, hunks[0].new_lines), (1, 0));
    }

    #[test]
    fn identical_text_has_no_hunks_and_crlf_is_trimmed() {
        assert!(build_hunks("same\n", "same\n").0.is_empty());
        let (hunks, _) = build_hunks("a\r\nb\r\n", "a\r\nB\r\n");
        assert_eq!(
            hunks[0]
                .lines
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>(),
            ["a", "b", "B"]
        );
    }
}
