use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::cache::{self, CachedGraph, Fingerprint, MIN_CACHED_COMMITS};
use crate::error::AppError;
use crate::git::commits::{self, LoadEvent, RefFilter};
use crate::git::diff::{self, CommitDetails, FileDiff};
use crate::git::fetch::{FetchState, Fetcher};
use crate::git::repo::{self, RepoInfo};
use crate::git::search::{self, SearchField, SearchResult};
use crate::git::stash::{self, StashEntry};
use crate::git::worktree::{self, WorktreeStatus};
use crate::session::AppState;
use crate::watcher::RepoWatcher;

/// Event sent to the frontend, with the session id as payload, when a repository's refs change.
pub const REPO_CHANGED_EVENT: &str = "repo-changed";
/// Event sent to the frontend, with the session id as payload, when the working copy or the index
/// changes (files edited, staged or unstaged).
pub const WORKTREE_CHANGED_EVENT: &str = "worktree-changed";
/// Event sent to the frontend, with the session id as payload, when a background fetch starts or
/// ends; `fetch_status` tells how it went.
pub const FETCH_CHANGED_EVENT: &str = "fetch-changed";

/// Opens a repository read-only, registers a session for it and returns a summary.
#[tauri::command]
#[specta::specta]
pub async fn open_repo(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<RepoInfo, AppError> {
    let session_id = state.next_session_id();
    let id = session_id.clone();
    let (info, handle) =
        tauri::async_runtime::spawn_blocking(move || repo::open(&PathBuf::from(path), id))
            .await
            .map_err(|err| AppError::Internal(err.to_string()))??;
    let watchers = [
        start_watcher(&app, &session_id, &handle),
        start_worktree_watcher(&app, &session_id, &handle),
    ];
    let fetcher = {
        let app = app.clone();
        let id = session_id.clone();
        Fetcher::start(&handle.to_thread_local(), move || {
            let _ = app.emit(FETCH_CHANGED_EVENT, id.as_str());
        })
    };
    state.insert(
        session_id,
        handle,
        watchers.into_iter().flatten().collect(),
        fetcher,
    );
    Ok(info)
}

/// Watching is a convenience: if it cannot start (no file system events, too many watches), the
/// repository still opens, it just does not refresh by itself.
fn start_watcher(
    app: &tauri::AppHandle,
    session_id: &str,
    handle: &gix::ThreadSafeRepository,
) -> Option<RepoWatcher> {
    let repo = handle.to_thread_local();
    let app = app.clone();
    let id = session_id.to_owned();
    let started = RepoWatcher::start(repo.git_dir(), repo.common_dir(), move || {
        let _ = app.emit(REPO_CHANGED_EVENT, id.as_str());
    });
    match started {
        Ok(watcher) => Some(watcher),
        Err(err) => {
            tracing::warn!(%err, "not watching the repository for changes");
            None
        }
    }
}

/// Like `start_watcher`, for the working copy. A bare repository has none.
fn start_worktree_watcher(
    app: &tauri::AppHandle,
    session_id: &str,
    handle: &gix::ThreadSafeRepository,
) -> Option<RepoWatcher> {
    let repo = handle.to_thread_local();
    let workdir = repo.workdir()?;
    let app = app.clone();
    let id = session_id.to_owned();
    let started = RepoWatcher::start_worktree(workdir, repo.git_dir(), move || {
        let _ = app.emit(WORKTREE_CHANGED_EVENT, id.as_str());
    });
    match started {
        Ok(watcher) => Some(watcher),
        Err(err) => {
            tracing::warn!(%err, "not watching the working copy for changes");
            None
        }
    }
}

/// Drops the session of a repository and stops any load still running on it.
#[tauri::command]
#[specta::specta]
pub fn close_repo(state: State<'_, AppState>, session_id: String) {
    state.remove(&session_id);
}

/// Streams every commit of the repository, in topological order, through `on_event`.
/// With `only`, just the commits reachable from those refs (the branch filter); every ref is still
/// sent. The full graph comes from the on-disk cache when the repository's refs are unchanged
/// since it was written. Starting a new load on the same session cancels the previous one.
#[tauri::command]
#[specta::specta]
pub async fn load_commits(
    state: State<'_, AppState>,
    session_id: String,
    only: Option<Vec<RefFilter>>,
    on_event: Channel<LoadEvent>,
) -> Result<(), AppError> {
    let session = state.get(&session_id)?;
    let generation = session.begin_load();
    let cache_dir = state.cache_dir().to_path_buf();

    tauri::async_runtime::spawn_blocking(move || {
        let repo = commits::repo_for_walk(&session.repo);
        let snapshot = commits::collect_refs(&repo)?;
        let fingerprint = Fingerprint::of(&snapshot.labels);
        let tips = snapshot.tips_for(only.as_deref());
        if on_event
            .send(LoadEvent::Refs {
                refs: snapshot.labels,
            })
            .is_err()
        {
            return Ok(());
        }

        let cache_file = cache::path_for(&cache_dir, repo.git_dir());
        let cancelled = || !session.is_current_load(generation);
        let mut send = |commits: Vec<_>, rows: Vec<_>| {
            on_event.send(LoadEvent::Chunk { commits, rows }).is_ok()
        };

        // A filtered graph is quick to rebuild and would only push the full one out of the cache.
        let cached = if only.is_none() {
            cache::load(&cache_file, &fingerprint)
        } else {
            None
        };
        let (stats, to_cache) = match cached {
            Some(graph) => (commits::stream_cached(&graph, &cancelled, &mut send), None),
            None => {
                let mut collected = CachedGraph {
                    commits: Vec::new(),
                    rows: Vec::new(),
                    max_lanes: 0,
                };
                let stats =
                    commits::stream_commits(&repo, tips, &cancelled, &mut |commits, rows| {
                        collected.commits.extend(commits.iter().cloned());
                        collected.rows.extend(rows.iter().cloned());
                        send(commits, rows)
                    })?;
                collected.max_lanes = stats.max_lanes;
                (stats, only.is_none().then_some(collected))
            }
        };

        if !session.is_current_load(generation) {
            return Ok(());
        }
        let _ = on_event.send(LoadEvent::Done {
            total: stats.total,
            setup_ms: stats.setup_ms,
            first_chunk_ms: stats.first_chunk_ms,
            total_ms: stats.total_ms,
            max_lanes: stats.max_lanes,
            from_cache: stats.from_cache,
        });

        // Written after `Done`, so saving never delays what the user sees.
        if let Some(graph) = to_cache
            && graph.commits.len() >= MIN_CACHED_COMMITS
            && graph.commits.len() == stats.total as usize
            && let Err(err) = cache::store(&cache_file, &fingerprint, &graph)
        {
            tracing::warn!(%err, "could not write the graph cache");
        }
        Ok(())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Metadata and changed files of one commit, compared with its first parent.
#[tauri::command]
#[specta::specta]
pub async fn commit_details(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
) -> Result<CommitDetails, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        diff::commit_details(&session.repo.to_thread_local(), &commit_id)
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Line diff of one file of a commit. `old_path` is the previous path of a renamed file.
#[tauri::command]
#[specta::specta]
pub async fn file_diff(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
    path: String,
    old_path: Option<String>,
) -> Result<FileDiff, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        diff::file_diff(
            &session.repo.to_thread_local(),
            &commit_id,
            &path,
            old_path.as_deref(),
        )
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Stashes of the repository, newest first.
#[tauri::command]
#[specta::specta]
pub async fn list_stashes(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<StashEntry>, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        stash::list_stashes(&session.repo.to_thread_local())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Commits whose whole message contains `text`, or that changed the path `text`. Searches every
/// ref (the frontend drops what the branch filter hides). A new search on the same session stops
/// the previous one, which then returns early with `cancelled` set.
#[tauri::command]
#[specta::specta]
pub async fn search_commits(
    state: State<'_, AppState>,
    session_id: String,
    field: SearchField,
    text: String,
) -> Result<SearchResult, AppError> {
    let session = state.get(&session_id)?;
    let generation = session.begin_search();
    tauri::async_runtime::spawn_blocking(move || {
        let repo = commits::repo_for_walk(&session.repo);
        let tips = commits::collect_refs(&repo)?.tips;
        let cancelled = || !session.is_current_search(generation);
        search::search_commits(&repo, tips, field, &text, &cancelled)
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Local changes of the working copy: staged and not, like `git status`.
#[tauri::command]
#[specta::specta]
pub async fn worktree_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<WorktreeStatus, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        worktree::worktree_status(&session.repo.to_thread_local())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Line diff of one locally changed file: HEAD → index when `staged`, else index → disk.
#[tauri::command]
#[specta::specta]
pub async fn worktree_diff(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    old_path: Option<String>,
    staged: bool,
) -> Result<FileDiff, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        worktree::worktree_diff(
            &session.repo.to_thread_local(),
            &path,
            old_path.as_deref(),
            staged,
        )
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// How the background fetch of the remote branches is going.
#[tauri::command]
#[specta::specta]
pub fn fetch_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<FetchState, AppError> {
    Ok(state.get(&session_id)?.fetcher.state())
}

/// Fetches the remote branches now instead of waiting for the next round.
#[tauri::command]
#[specta::specta]
pub fn fetch_now(state: State<'_, AppState>, session_id: String) -> Result<(), AppError> {
    state.get(&session_id)?.fetcher.fetch_now();
    Ok(())
}
