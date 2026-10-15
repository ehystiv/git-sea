use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::error::AppError;
use crate::watcher::RepoWatcher;

/// Backend state of one open repository (one per tab).
pub struct RepoSession {
    pub repo: gix::ThreadSafeRepository,
    /// Bumped on every commit load (and on close); a running load stops when its
    /// generation is no longer the current one.
    load_generation: AtomicU64,
    /// Keeps watching the repository's refs for as long as the session lives.
    _watcher: Option<RepoWatcher>,
}

impl RepoSession {
    fn new(repo: gix::ThreadSafeRepository, watcher: Option<RepoWatcher>) -> Self {
        Self {
            repo,
            load_generation: AtomicU64::new(0),
            _watcher: watcher,
        }
    }

    /// Starts a new load, invalidating any load already running on this session.
    pub fn begin_load(&self) -> u64 {
        self.load_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn is_current_load(&self, generation: u64) -> bool {
        self.load_generation.load(Ordering::SeqCst) == generation
    }

    fn cancel_loads(&self) {
        self.load_generation.fetch_add(1, Ordering::SeqCst);
    }
}

pub struct AppState {
    sessions: Mutex<HashMap<String, Arc<RepoSession>>>,
    next_id: AtomicU64,
    cache_dir: PathBuf,
}

impl AppState {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            cache_dir,
        }
    }

    /// Where graph caches are written.
    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn next_session_id(&self) -> String {
        format!("s{}", self.next_id.fetch_add(1, Ordering::SeqCst) + 1)
    }

    pub fn insert(
        &self,
        id: String,
        repo: gix::ThreadSafeRepository,
        watcher: Option<RepoWatcher>,
    ) {
        self.lock()
            .insert(id, Arc::new(RepoSession::new(repo, watcher)));
    }

    pub fn get(&self, id: &str) -> Result<Arc<RepoSession>, AppError> {
        self.lock()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::SessionNotFound(id.to_owned()))
    }

    pub fn remove(&self, id: &str) {
        if let Some(session) = self.lock().remove(id) {
            session.cancel_loads();
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<RepoSession>>> {
        // A poisoned lock only means another thread panicked mid-insert/remove;
        // the map itself is still consistent.
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}
