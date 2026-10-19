use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::cache::{self, CacheUsage, CachedGraph, Fingerprint, MIN_CACHED_COMMITS};
use crate::ci::pulls::PullRequestsReport;
use crate::ci::remote::RepoWeb;
use crate::ci::runs::CiRunsReport;
use crate::ci::{self, CiOverview, CiProvider};
use crate::error::AppError;
use crate::git::blame::{self, FileBlame};
use crate::git::commits::{self, LoadEvent, RefFilter};
use crate::git::diff::{self, CommitDetails, FileDiff};
use crate::git::fetch::{FetchState, Fetcher};
use crate::git::repo::{self, RepoInfo};
use crate::git::search::{self, SearchField, SearchResult};
use crate::git::stash::{self, StashEntry};
use crate::git::upstream::{self, Upstream};
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
            cache::load(&cache_file, repo.git_dir(), &fingerprint)
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
            && let Err(err) = cache::store(&cache_file, repo.git_dir(), &fingerprint, &graph)
        {
            tracing::warn!(%err, "could not write the graph cache");
        }
        Ok(())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Streams the history of one commit (it and its ancestors), laid out as a graph of its own, for
/// a replay that ends there. Leaves the session's load and the cache alone.
#[tauri::command]
#[specta::specta]
pub async fn replay_commits(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
    on_event: Channel<LoadEvent>,
) -> Result<(), AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = commits::repo_for_walk(&session.repo);
        let tip = gix::ObjectId::from_hex(commit_id.as_bytes())
            .map_err(|_| AppError::Git(format!("not an object id: {commit_id}")))?;
        let refs = commits::collect_refs(&repo)?.labels;
        if on_event.send(LoadEvent::Refs { refs }).is_err() {
            return Ok(());
        }
        let stats = commits::stream_commits(&repo, vec![tip], &|| false, &mut |commits, rows| {
            on_event.send(LoadEvent::Chunk { commits, rows }).is_ok()
        })?;
        let _ = on_event.send(LoadEvent::Done {
            total: stats.total,
            setup_ms: stats.setup_ms,
            first_chunk_ms: stats.first_chunk_ms,
            total_ms: stats.total_ms,
            max_lanes: stats.max_lanes,
            from_cache: false,
        });
        Ok(())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Metadata and changed files of one commit, compared with its first parent, or with `base`
/// (another parent of a merge, or any commit) when given.
#[tauri::command]
#[specta::specta]
pub async fn commit_details(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
    base: Option<String>,
) -> Result<CommitDetails, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = session.repo.to_thread_local();
        diff::commit_details(&repo, &commit_id, base.as_deref())
            .map_err(|err| repo::in_partial_clone(&repo, err))
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Line diff of one file of a commit, against its first parent or `base`. `old_path` is the
/// previous path of a renamed file.
#[tauri::command]
#[specta::specta]
pub async fn file_diff(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
    path: String,
    old_path: Option<String>,
    base: Option<String>,
) -> Result<FileDiff, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = session.repo.to_thread_local();
        diff::file_diff(
            &repo,
            &commit_id,
            &path,
            old_path.as_deref(),
            base.as_deref(),
        )
        .map_err(|err| repo::in_partial_clone(&repo, err))
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// For every line of a file as it is in a commit, the commit that last changed it.
#[tauri::command]
#[specta::specta]
pub async fn blame_file(
    state: State<'_, AppState>,
    session_id: String,
    commit_id: String,
    path: String,
) -> Result<FileBlame, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = commits::repo_for_walk(&session.repo);
        blame::blame_file(&repo, &commit_id, &path)
            .map_err(|err| repo::in_partial_clone(&repo, err))
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

/// How many graph files the cache holds and their size.
#[tauri::command]
#[specta::specta]
pub fn cache_usage(state: State<'_, AppState>) -> CacheUsage {
    cache::usage(state.cache_dir())
}

/// Deletes every graph file of the cache; graphs are built again on the next load.
#[tauri::command]
#[specta::specta]
pub fn clear_cache(state: State<'_, AppState>) -> Result<u32, AppError> {
    cache::clear(state.cache_dir()).map_err(|err| AppError::Internal(err.to_string()))
}

/// The upstream of every local branch that has one.
#[tauri::command]
#[specta::specta]
pub async fn list_upstreams(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<Upstream>, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        upstream::list_upstreams(&session.repo.to_thread_local())
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
            .map_err(|err| repo::in_partial_clone(&repo, err))
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

/// The workflows defined in HEAD and the refs a push or a pull request would start them on.
#[tauri::command]
#[specta::specta]
pub async fn ci_overview(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<CiOverview, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = session.repo.to_thread_local();
        let refs = commits::collect_refs(&repo)?;
        ci::overview(&repo, &refs.labels)
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Recent runs of the CI services the repository's workflows belong to. Calls their APIs.
#[tauri::command]
#[specta::specta]
pub async fn ci_runs(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<CiRunsReport, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let repo = session.repo.to_thread_local();
        let (definitions, _) = ci::read_definitions(&repo)?;
        let providers: Vec<CiProvider> = definitions.iter().map(|d| d.provider).collect();
        let remote = ci::remote::main_remote(&repo);
        Ok(ci::runs::fetch_runs(&providers, remote.as_ref()))
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// The recently updated pull requests (GitHub) or merge requests (GitLab) of the main remote's
/// project. Calls the service's API.
#[tauri::command]
#[specta::specta]
pub async fn pull_requests(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<PullRequestsReport, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let remote = ci::remote::main_remote(&session.repo.to_thread_local());
        ci::pulls::fetch_pulls(remote.as_ref())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))
}

/// Saves the token for a CI service in the Keychain; None removes it.
#[tauri::command]
#[specta::specta]
pub async fn ci_set_token(provider: CiProvider, token: Option<String>) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = match token.as_deref().map(str::trim) {
            Some(token) if !token.is_empty() => ci::auth::keychain_set(provider, token),
            _ => ci::auth::keychain_delete(provider),
        };
        result.map_err(AppError::Internal)
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Where the repository's commits can be seen on the web (from `origin`, else the first remote),
/// or `None` for a local repository or an unknown service.
#[tauri::command]
#[specta::specta]
pub async fn repo_web(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<RepoWeb>, AppError> {
    let session = state.get(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::ci::remote::main_remote(&session.repo.to_thread_local())
            .and_then(|remote| remote.commit_page())
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))
}

/// Kinds of file the views can be exported as.
#[derive(Debug, Clone, Copy, serde::Deserialize, specta::Type)]
pub enum ExportFormat {
    Png,
    Gif,
    Webm,
    Mp4,
}

impl ExportFormat {
    fn filter(self) -> (&'static str, &'static str) {
        match self {
            ExportFormat::Png => ("PNG", "png"),
            ExportFormat::Gif => ("GIF", "gif"),
            ExportFormat::Webm => ("WebM", "webm"),
            ExportFormat::Mp4 => ("MP4", "mp4"),
        }
    }
}

/// Asks where to save an export (an image or a video, sent as base64) and writes it there.
/// Returns the path, or `None` when the user cancelled. The dialog is opened here, so the
/// frontend has no way to write anywhere it was not told to.
#[tauri::command]
#[specta::specta]
pub async fn save_export(
    app: tauri::AppHandle,
    file_name: String,
    base64: String,
    format: ExportFormat,
) -> Result<Option<String>, AppError> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|err| AppError::Internal(format!("not a base64 file: {err}")))?;
    let (name, extension) = format.filter();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(chosen) = app
            .dialog()
            .file()
            .add_filter(name, &[extension])
            .set_file_name(&file_name)
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = chosen
            .into_path()
            .map_err(|err| AppError::Internal(err.to_string()))?;
        std::fs::write(&path, bytes).map_err(|err| AppError::Internal(err.to_string()))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|err| AppError::Internal(err.to_string()))?
}

/// Opens a web page (a CI run) in the default browser. Only `https` links are opened.
#[tauri::command]
#[specta::specta]
pub fn open_url(url: String) -> Result<(), AppError> {
    if !url.starts_with("https://") || url.contains(char::is_whitespace) {
        return Err(AppError::Internal(format!("not an https link: {url}")));
    }
    crate::process::open_url(&url).map_err(|err| AppError::Internal(err.to_string()))
}

/// The user's system language (a BCP 47 tag such as "it-IT"), for the default UI language.
#[tauri::command]
#[specta::specta]
pub fn system_locale() -> Option<String> {
    crate::i18n::system_locale()
}

/// Sets the language of the native menu and of the messages the backend sends.
#[tauri::command]
#[specta::specta]
pub fn set_language(
    app: tauri::AppHandle,
    language: crate::i18n::Language,
) -> Result<(), AppError> {
    crate::i18n::set(language);
    let menu = crate::build_menu(&app).map_err(|err| AppError::Internal(err.to_string()))?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|err| AppError::Internal(err.to_string()))
}
