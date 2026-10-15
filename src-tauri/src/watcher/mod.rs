//! Tells the app when a repository's refs change, so the graph can be refreshed.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// Changes closer together than this count as one (a commit or a fetch touches several files).
const QUIET: Duration = Duration::from_millis(300);

/// Watching stops when this is dropped.
pub struct RepoWatcher {
    _watcher: RecommendedWatcher,
}

impl RepoWatcher {
    /// Watches `git_dir` (and `common_dir`, which differs for a linked worktree) and calls
    /// `on_change` once changes to `HEAD`, `packed-refs` or anything under `refs/` have settled.
    /// The callback runs on a background thread.
    pub fn start(
        git_dir: &Path,
        common_dir: &Path,
        on_change: impl Fn() + Send + 'static,
    ) -> notify::Result<Self> {
        // Events report real paths (macOS: /private/var, not /var), so compare against those.
        let mut roots: Vec<PathBuf> = [git_dir, common_dir]
            .iter()
            .map(|dir| dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf()))
            .collect();
        roots.dedup();

        let (tx, rx) = mpsc::channel::<()>();
        let filter_roots = roots.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event
                    && event
                        .paths
                        .iter()
                        .any(|path| is_ref_path(path, &filter_roots))
                {
                    let _ = tx.send(());
                }
            })?;
        for root in &roots {
            watcher.watch(root, RecursiveMode::Recursive)?;
        }

        thread::spawn(move || {
            // Ends when the watcher, which owns the sender, is dropped.
            while rx.recv().is_ok() {
                loop {
                    match rx.recv_timeout(QUIET) {
                        Ok(()) => continue,
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
                on_change();
            }
        });

        Ok(Self { _watcher: watcher })
    }
}

/// Whether a changed path can change what the graph shows: `HEAD`, `packed-refs`, or any ref
/// (branches, remotes, tags, the stash). Everything else in the git directory, such as objects,
/// the index, logs and lock files, is noise.
pub fn is_ref_path(path: &Path, roots: &[PathBuf]) -> bool {
    let Some(relative) = roots.iter().find_map(|root| path.strip_prefix(root).ok()) else {
        return false;
    };
    if relative.extension().is_some_and(|ext| ext == "lock") {
        return false;
    }
    let mut parts = relative.components();
    match parts.next().and_then(|c| c.as_os_str().to_str()) {
        Some("HEAD" | "packed-refs") => parts.next().is_none(),
        Some("refs") => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots() -> Vec<PathBuf> {
        vec![PathBuf::from("/repo/.git")]
    }

    #[test]
    fn refs_head_and_packed_refs_count() {
        for path in [
            "/repo/.git/HEAD",
            "/repo/.git/packed-refs",
            "/repo/.git/refs/heads/main",
            "/repo/.git/refs/remotes/origin/feature/x",
            "/repo/.git/refs/tags/v1",
            "/repo/.git/refs/stash",
            "/repo/.git/refs",
        ] {
            assert!(is_ref_path(Path::new(path), &roots()), "{path}");
        }
    }

    #[test]
    fn everything_else_in_the_git_directory_is_noise() {
        for path in [
            "/repo/.git/index",
            "/repo/.git/objects/ab/cdef",
            "/repo/.git/logs/HEAD",
            "/repo/.git/FETCH_HEAD",
            "/repo/.git/refs/heads/main.lock",
            "/repo/.git/HEAD.lock",
            "/repo/.git/packed-refs.lock",
            "/repo/.git/HEAD/nested",
            "/elsewhere/refs/heads/main",
        ] {
            assert!(!is_ref_path(Path::new(path), &roots()), "{path}");
        }
    }

    #[test]
    fn a_linked_worktree_watches_both_its_own_and_the_common_directory() {
        let roots = vec![
            PathBuf::from("/repo/.git/worktrees/wt"),
            PathBuf::from("/repo/.git"),
        ];
        assert!(is_ref_path(
            Path::new("/repo/.git/worktrees/wt/HEAD"),
            &roots
        ));
        assert!(is_ref_path(Path::new("/repo/.git/refs/heads/main"), &roots));
    }
}
