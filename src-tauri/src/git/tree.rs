//! The files of a commit's tree, and the content of one of them, to browse the repository as it
//! was at that commit.

use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::{MAX_BLOB_BYTES, git, parse_id};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
pub enum EntryKind {
    File,
    /// A file with the executable bit.
    Executable,
    Symlink,
    /// A pointer to a commit of another repository.
    Submodule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct TreeFile {
    /// Full path from the root of the repository, with `/` between directories.
    pub path: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub kind: EntryKind,
    /// Size in bytes; for a submodule, 0.
    #[specta(type = f64)]
    pub size: u64,
    pub binary: bool,
    /// The file is too big to show.
    pub too_large: bool,
    /// The file's lines, without their line endings; a symlink's single line is its target; a
    /// submodule's is the commit it points to.
    pub lines: Vec<String>,
}

fn kind_of(mode: gix::object::tree::EntryMode) -> Option<EntryKind> {
    use gix::object::tree::EntryKind as Kind;
    match mode.kind() {
        Kind::Tree => None,
        Kind::Blob => Some(EntryKind::File),
        Kind::BlobExecutable => Some(EntryKind::Executable),
        Kind::Link => Some(EntryKind::Symlink),
        Kind::Commit => Some(EntryKind::Submodule),
    }
}

/// Every file (not directory) of the tree of `commit_id`, sorted by path.
pub fn list_files(repo: &gix::Repository, commit_id: &str) -> Result<Vec<TreeFile>, AppError> {
    let tree = repo
        .find_commit(parse_id(commit_id)?)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let mut recorder = gix::traverse::tree::Recorder::default();
    tree.traverse().breadthfirst(&mut recorder).map_err(git)?;
    let mut files: Vec<TreeFile> = recorder
        .records
        .into_iter()
        .filter_map(|entry| {
            Some(TreeFile {
                kind: kind_of(entry.mode)?,
                path: entry.filepath.to_string(),
            })
        })
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

/// The content of the file at `path` in the tree of `commit_id`.
pub fn file_content(
    repo: &gix::Repository,
    commit_id: &str,
    path: &str,
) -> Result<FileContent, AppError> {
    let tree = repo
        .find_commit(parse_id(commit_id)?)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let entry = tree
        .lookup_entry_by_path(path)
        .map_err(git)?
        .ok_or_else(|| AppError::Git(format!("{path} is not in {commit_id}")))?;
    let kind =
        kind_of(entry.mode()).ok_or_else(|| AppError::Git(format!("{path} is a directory")))?;
    let mut result = FileContent {
        path: path.to_owned(),
        kind,
        size: 0,
        binary: false,
        too_large: false,
        lines: Vec::new(),
    };
    if kind == EntryKind::Submodule {
        result.lines.push(entry.object_id().to_string());
        return Ok(result);
    }

    let object = repo.find_object(entry.object_id()).map_err(git)?;
    let data = &object.data;
    result.size = data.len() as u64;
    if data.iter().take(8_000).any(|&b| b == 0) {
        result.binary = true;
    } else if data.len() > MAX_BLOB_BYTES {
        result.too_large = true;
    } else {
        result.lines = String::from_utf8_lossy(data)
            .split_inclusive('\n')
            .map(|l| l.strip_suffix('\n').unwrap_or(l))
            .map(|l| l.strip_suffix('\r').unwrap_or(l).to_owned())
            .collect();
    }
    Ok(result)
}
