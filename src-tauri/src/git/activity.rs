//! Which files every commit changed, and how many lines it added and removed in each, for the
//! hotspots of the statistics: the files and directories changed most often, and by whom.
//!
//! Each commit is compared with its first parent (a root commit with the empty tree), without
//! rename tracking, which would cost far more than the tree diff itself. Merges are skipped, as
//! `git log --stat` does by default: their changes are already counted in the commits they bring.
//! Lines are counted only when asked for, since diffing every blob costs some twenty times more
//! than the tree diffs; then as in the details panel: binary files, submodules and blobs too big
//! to diff count 0 lines (the commit still counts).
//!
//! A commit's files never change, so the session keeps them: a later request (after a fetch, or
//! after leaving and reopening the statistics) only diffs the commits it has not seen. The work is
//! split over a few threads, each with its own repository handle.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;
use specta::Type;

use crate::error::AppError;
use crate::git::diff::git;

/// Progress is reported every this many commits.
const PROGRESS_STEP: usize = 500;
/// Commits handed to a thread at a time.
const BATCH: usize = 64;
const MAX_THREADS: usize = 8;

/// The files each commit changed (path indices), with every path stored once, and for the
/// commits read with lines, the lines added and removed in each file, in the same order.
#[derive(Default)]
pub struct ActivityCache {
    paths: Vec<String>,
    path_index: HashMap<String, u32>,
    by_commit: HashMap<gix::ObjectId, Vec<u32>>,
    lines: HashMap<gix::ObjectId, Vec<[u32; 2]>>,
}

impl ActivityCache {
    fn intern(&mut self, path: String) -> u32 {
        if let Some(&at) = self.path_index.get(&path) {
            return at;
        }
        let at = u32::try_from(self.paths.len()).unwrap_or(u32::MAX);
        self.paths.push(path.clone());
        self.path_index.insert(path, at);
        at
    }
}

/// One commit and the indices (in `FileActivity::paths`) of the files it changed, with the lines
/// added and removed in each, in the same order, when they were asked for.
#[derive(Debug, Clone, Serialize, Type)]
pub struct CommitFiles {
    pub id: String,
    pub files: Vec<u32>,
    pub added: Option<Vec<u32>>,
    pub removed: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct FileActivity {
    pub paths: Vec<String>,
    /// Commits that changed at least one file; merges are left out.
    pub commits: Vec<CommitFiles>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum ActivityEvent {
    /// `done` of the `total` commits not seen before have been read.
    Progress {
        done: u32,
        total: u32,
    },
    Done(FileActivity),
}

/// A commit to read: its first parent, unless it is a merge (nothing to read) or a root.
struct Pending {
    id: gix::ObjectId,
    parent: Option<gix::ObjectId>,
}

/// The files changed by every commit reachable from `tips`, and with `lines` the lines added and
/// removed in each. Commits already in `cache` (with lines, when asked for) are not read again;
/// new ones are added to it. Returns `None` when `cancelled` (what was read so far
/// stays in the cache). `progress` is called with (done, total) as the commits are read.
pub fn file_activity(
    handle: &gix::ThreadSafeRepository,
    tips: Vec<gix::ObjectId>,
    cache: &Mutex<ActivityCache>,
    lines: bool,
    cancelled: &(dyn Fn() -> bool + Sync),
    progress: &(dyn Fn(u32, u32) + Sync),
) -> Result<Option<FileActivity>, AppError> {
    let repo = crate::git::commits::repo_for_walk(handle);
    let mut all = Vec::new();
    let mut pending = Vec::new();
    {
        let known = lock(cache);
        for info in repo.rev_walk(tips).all().map_err(git)? {
            let info = info.map_err(git)?;
            let parents: Vec<gix::ObjectId> = info.parent_ids().map(|p| p.detach()).collect();
            all.push(info.id);
            let known = known.by_commit.contains_key(&info.id)
                && (!lines || known.lines.contains_key(&info.id));
            if parents.len() > 1 || known {
                continue;
            }
            pending.push(Pending {
                id: info.id,
                parent: parents.first().copied(),
            });
        }
    }

    let total = count(pending.len());
    if !pending.is_empty() {
        progress(0, total);
        let next = AtomicUsize::new(0);
        let done = AtomicUsize::new(0);
        let threads = std::thread::available_parallelism()
            .map_or(2, std::num::NonZero::get)
            .clamp(1, MAX_THREADS)
            .min(pending.len().div_ceil(BATCH));
        let failed: Mutex<Option<AppError>> = Mutex::new(None);
        std::thread::scope(|scope| {
            for _ in 0..threads {
                scope.spawn(|| {
                    let repo = crate::git::commits::repo_for_walk(handle);
                    loop {
                        if cancelled() || lock(&failed).is_some() {
                            return;
                        }
                        let start = next.fetch_add(BATCH, Ordering::SeqCst);
                        let Some(batch) = pending.get(start..(start + BATCH).min(pending.len()))
                        else {
                            return;
                        };
                        let mut read = Vec::with_capacity(batch.len());
                        for item in batch {
                            match changed_files(&repo, item, lines) {
                                Ok(paths) => read.push((item.id, paths)),
                                Err(err) => {
                                    *lock(&failed) = Some(err);
                                    return;
                                }
                            }
                        }
                        {
                            let mut cache = lock(cache);
                            for (id, changed) in read {
                                if lines {
                                    let counts = changed.iter().map(|f| [f.1, f.2]).collect();
                                    cache.lines.insert(id, counts);
                                }
                                let files =
                                    changed.into_iter().map(|f| cache.intern(f.0)).collect();
                                cache.by_commit.insert(id, files);
                            }
                        }
                        let before = done.fetch_add(batch.len(), Ordering::SeqCst);
                        let after = before + batch.len();
                        if after / PROGRESS_STEP != before / PROGRESS_STEP {
                            progress(count(after), total);
                        }
                    }
                });
            }
        });
        if let Some(err) = lock(&failed).take() {
            return Err(err);
        }
    }
    if cancelled() {
        return Ok(None);
    }

    let cache = lock(cache);
    let commits = all
        .iter()
        .filter_map(|id| {
            let files = cache.by_commit.get(id)?;
            let counts = lines.then(|| cache.lines.get(id)).flatten();
            (!files.is_empty()).then(|| CommitFiles {
                id: id.to_string(),
                files: files.clone(),
                added: counts.map(|c| c.iter().map(|n| n[0]).collect()),
                removed: counts.map(|c| c.iter().map(|n| n[1]).collect()),
            })
        })
        .collect();
    Ok(Some(FileActivity {
        paths: cache.paths.clone(),
        commits,
    }))
}

/// The files (not directories) `item` changed against its first parent: path, lines added, lines
/// removed (0 and 0 without `lines`).
fn changed_files(
    repo: &gix::Repository,
    item: &Pending,
    lines: bool,
) -> Result<Vec<(String, u32, u32)>, AppError> {
    use gix::object::tree::diff::ChangeDetached;
    let tree = repo
        .find_commit(item.id)
        .map_err(git)?
        .tree()
        .map_err(git)?;
    let parent = match item.parent {
        Some(id) => Some(repo.find_commit(id).map_err(git)?.tree().map_err(git)?),
        None => None,
    };
    let changes = repo
        .diff_tree_to_tree(parent.as_ref(), Some(&tree), gix::diff::Options::default())
        .map_err(git)?;
    Ok(changes
        .iter()
        .filter_map(|change| match change {
            ChangeDetached::Addition {
                location,
                entry_mode,
                ..
            }
            | ChangeDetached::Deletion {
                location,
                entry_mode,
                ..
            }
            | ChangeDetached::Modification {
                location,
                entry_mode,
                ..
            }
            | ChangeDetached::Rewrite {
                location,
                entry_mode,
                ..
            } => (!entry_mode.is_tree()).then(|| {
                let stats = lines.then(|| crate::git::diff::line_stats(repo, change));
                let (added, removed) = match stats.flatten() {
                    Some((added, removed, false)) => (added, removed),
                    _ => (0, 0),
                };
                (location.to_string(), added, removed)
            }),
        })
        .collect())
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A poisoned lock only means another thread panicked; the data is still usable.
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
